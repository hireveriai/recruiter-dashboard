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
      i.candidate_feedback_status
    from public.interviews i
    join public.candidates c on c.candidate_id = i.candidate_id
    join public.job_positions jp on jp.job_id = i.job_id
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
              "Write 3-5 short paragraphs, warm and professional in tone, second person ('you').",
              "Cover: 1-2 genuine strengths from their answers, then 1-2 areas to develop, framed constructively.",
              "Never mention scores, percentages, risk levels, fraud signals, or any internal evaluation terminology.",
              "Never state or imply a hiring decision or outcome (hired, rejected, moving forward, etc.) -- that is for the recruiter to communicate separately.",
              "Do not fabricate specifics the transcript does not support. If the transcript is too thin to say much, keep it brief and general rather than inventing detail.",
              "Sign off with 'Best regards,' on its own line at the end (no name after it -- the recruiter will add their own).",
              "Return plain text only, no markdown formatting.",
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

export async function sendCandidateFeedback(organizationId: string, interviewId: string, text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new ApiError(400, "FEEDBACK_TEXT_REQUIRED", "Feedback text is required.")
  }

  const context = await loadInterviewContext(organizationId, interviewId)
  if (!context) {
    throw new ApiError(404, "INTERVIEW_NOT_FOUND", "Interview not found for this organization.")
  }
  if (!context.candidate_email) {
    throw new ApiError(409, "CANDIDATE_EMAIL_MISSING", "This candidate has no email on file to send feedback to.")
  }

  const { sendCandidateFeedbackEmail } = await import("@/lib/services/email.service")
  await sendCandidateFeedbackEmail({
    to: context.candidate_email,
    candidateName: context.candidate_name,
    jobTitle: context.job_title,
    feedbackText: trimmed,
  })

  await prisma.$executeRaw`
    update public.interviews
    set candidate_feedback_text = ${trimmed},
        candidate_feedback_status = 'sent',
        candidate_feedback_sent_at = now(),
        candidate_feedback_sent_to = ${context.candidate_email}
    where interview_id = ${interviewId}::uuid
  `

  return { sentTo: context.candidate_email, sentAt: new Date().toISOString() }
}
