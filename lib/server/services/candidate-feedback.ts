import { prisma } from "@/lib/server/prisma"
import { ApiError } from "@/lib/server/errors"
import { fetchAnswerSummaries, type InterviewAnswerSummary } from "@/lib/server/services/interview-summary"

type InterviewContextRow = {
  interview_id: string
  organization_id: string
  candidate_name: string
  candidate_email: string | null
  job_title: string
  attempt_id: string | null
  candidate_feedback_text: string | null
  candidate_feedback_status: string | null
  organization_name: string
}

async function loadInterviewContext(organizationId: string, interviewId: string) {
  const rows = await prisma.$queryRaw<InterviewContextRow[]>`
    select
      i.interview_id::text,
      i.organization_id::text,
      c.full_name as candidate_name,
      c.email as candidate_email,
      jp.job_title,
      (
        select ia.attempt_id::text
        from public.interview_attempts ia
        where ia.interview_id = i.interview_id
        order by ia.started_at desc
        limit 1
      ) as attempt_id,
      i.candidate_feedback_text,
      i.candidate_feedback_status,
      o.organization_name
    from public.interviews i
    join public.candidates c on c.candidate_id = i.candidate_id
    join public.job_positions jp on jp.job_id = i.job_id
    join public.organizations o on o.organization_id = i.organization_id
    where i.interview_id = ${interviewId}::uuid
      and i.organization_id = ${organizationId}::uuid
    limit 1
  `

  return rows[0] ?? null
}

function buildTranscriptExcerpt(answers: InterviewAnswerSummary[]) {
  return answers
    .filter((answer) => answer.answerText && answer.answerText !== "No response provided.")
    .map((answer, index) => `Q${answer.questionOrder ?? index + 1}: ${answer.question}\nCandidate: ${answer.answerText}`)
    .join("\n\n")
    .slice(0, 12_000)
}

// This is a deliberately different, second AI pass from the recruiter-facing
// VERIS evaluation -- that one includes fraud/risk scores and blunt
// recruiter-oriented language ("lack of depth", risk flags) that must never
// go to a candidate verbatim, both for tone and because specific rejection
// reasoning is a real source of legal exposure. This prompt only ever
// produces constructive, generic-enough feedback on interview performance.
async function generateFeedbackText(input: {
  candidateName: string
  jobTitle: string
  transcriptExcerpt: string
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new ApiError(503, "OPENAI_UNAVAILABLE", "AI feedback generation is not configured.")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: [
              "You write short, constructive interview feedback addressed directly to a job candidate.",
              "Output must follow this exact structured, two-section plain-text format, with no other headings and nothing before or after it:",
              "",
              "Strengths",
              "- <first strength, one sentence, second person 'you'>",
              "- <second strength, one sentence>",
              "",
              "Areas for Improvement",
              "- <first area to develop, one sentence, framed constructively>",
              "- <second area to develop, one sentence>",
              "",
              "Each section must have exactly 2 to 3 bullet points. The header lines must be exactly 'Strengths' and 'Areas for Improvement' -- no colons, no markdown symbols, no numbering.",
              "",
              "EVERY bullet must name a specific, concrete detail the candidate actually said -- a project, tool, technology, number, decision, situation, or example quoted or closely paraphrased from the transcript below. Two different candidates' feedback must never be interchangeable.",
              "Do not write a bare trait claim with no evidence attached in the same sentence. Banned as standalone claims: 'strong communication skills', 'good problem-solving abilities', 'attention to detail', 'team player', 'showed confidence', 'clear and organized' -- these may only appear immediately paired with the specific thing the candidate said that demonstrates it.",
              "If you cannot find a specific detail to support a bullet, do not invent one -- instead reference the general shape of what they discussed (e.g. the topic or question they were answering) rather than falling back to a generic trait claim.",
              "Never mention scores, percentages, risk levels, fraud signals, or any internal evaluation terminology.",
              "Never state or imply a hiring decision or outcome (hired, rejected, moving forward, etc.) -- that is for the recruiter to communicate separately.",
              "Only write a brief, clearly general note (not fabricated specifics) if the transcript excerpt is empty or contains no discernible answer content at all.",
              "Return plain text only, no markdown formatting, no bold, no asterisks.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              candidate_name: input.candidateName,
              role: input.jobTitle,
              interview_transcript_excerpt: input.transcriptExcerpt || "(no substantive answers were recorded)",
            }),
          },
        ],
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new ApiError(502, "FEEDBACK_GENERATION_FAILED", `AI feedback generation failed: ${text.slice(0, 300)}`)
    }

    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content

    if (typeof content !== "string" || !content.trim()) {
      throw new ApiError(502, "FEEDBACK_GENERATION_FAILED", "AI feedback generation returned an empty response.")
    }

    return content.trim()
  } finally {
    clearTimeout(timeout)
  }
}

export async function generateCandidateFeedback(organizationId: string, interviewId: string) {
  const context = await loadInterviewContext(organizationId, interviewId)
  if (!context) {
    throw new ApiError(404, "INTERVIEW_NOT_FOUND", "Interview not found for this organization.")
  }
  if (!context.attempt_id) {
    throw new ApiError(409, "INTERVIEW_NOT_COMPLETED", "This interview has no completed attempt to generate feedback from.")
  }

  const answerMap = await fetchAnswerSummaries([context.attempt_id])
  const answers = answerMap.get(context.attempt_id) ?? []
  const transcriptExcerpt = buildTranscriptExcerpt(answers)

  const text = await generateFeedbackText({
    candidateName: context.candidate_name,
    jobTitle: context.job_title,
    transcriptExcerpt,
  })

  await prisma.$executeRaw`
    update public.interviews
    set candidate_feedback_text = ${text},
        candidate_feedback_status = 'draft',
        candidate_feedback_generated_at = now()
    where interview_id = ${interviewId}::uuid
  `

  return { text, status: "draft" as const }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim())
}

export const CANDIDATE_FEEDBACK_HIRING_DECISIONS = ["SHORTLISTED", "REJECTED", "UNDISCLOSED"] as const

export type CandidateFeedbackHiringDecision = typeof CANDIDATE_FEEDBACK_HIRING_DECISIONS[number]

export function normalizeCandidateFeedbackHiringDecision(value: unknown): CandidateFeedbackHiringDecision {
  const normalized = String(value ?? "").trim().toUpperCase()
  return (CANDIDATE_FEEDBACK_HIRING_DECISIONS as readonly string[]).includes(normalized)
    ? (normalized as CandidateFeedbackHiringDecision)
    : "UNDISCLOSED"
}

export async function sendCandidateFeedback(
  organizationId: string,
  interviewId: string,
  text: string,
  options?: { to?: string; cc?: string[]; hiringDecision?: unknown; includeSignature?: boolean }
) {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new ApiError(400, "FEEDBACK_TEXT_REQUIRED", "Feedback text is required.")
  }

  const context = await loadInterviewContext(organizationId, interviewId)
  if (!context) {
    throw new ApiError(404, "INTERVIEW_NOT_FOUND", "Interview not found for this organization.")
  }

  // The recruiter can override the destination address in the modal (e.g.
  // the candidate's email on file is wrong or missing) and optionally add
  // themselves or a teammate as CC -- so this is not necessarily the
  // candidate's email on file.
  const recipientEmail = (options?.to?.trim() || context.candidate_email || "").trim()
  if (!recipientEmail) {
    throw new ApiError(409, "CANDIDATE_EMAIL_MISSING", "No recipient email was provided and none is on file for this candidate.")
  }
  if (!isValidEmail(recipientEmail)) {
    throw new ApiError(400, "INVALID_EMAIL", `"${recipientEmail}" is not a valid email address.`)
  }

  const ccEmails = (options?.cc ?? [])
    .map((email) => email.trim())
    .filter(Boolean)
  const invalidCc = ccEmails.find((email) => !isValidEmail(email))
  if (invalidCc) {
    throw new ApiError(400, "INVALID_EMAIL", `"${invalidCc}" is not a valid email address.`)
  }

  const hiringDecision = normalizeCandidateFeedbackHiringDecision(options?.hiringDecision)
  const includeSignature = Boolean(options?.includeSignature)

  const { sendCandidateFeedbackEmail } = await import("@/lib/services/email.service")
  await sendCandidateFeedbackEmail({
    to: recipientEmail,
    cc: ccEmails.length > 0 ? ccEmails : undefined,
    candidateName: context.candidate_name,
    jobTitle: context.job_title,
    feedbackText: trimmed,
    hiringDecision,
    organizationName: includeSignature ? context.organization_name : undefined,
  })

  const sentToLabel = [recipientEmail, ...ccEmails].join(", ")

  await prisma.$executeRaw`
    update public.interviews
    set candidate_feedback_text = ${trimmed},
        candidate_feedback_status = 'sent',
        candidate_feedback_sent_at = now(),
        candidate_feedback_sent_to = ${sentToLabel},
        candidate_feedback_hiring_decision = ${hiringDecision}
    where interview_id = ${interviewId}::uuid
  `

  return { sentTo: recipientEmail, cc: ccEmails, sentAt: new Date().toISOString(), hiringDecision }
}
