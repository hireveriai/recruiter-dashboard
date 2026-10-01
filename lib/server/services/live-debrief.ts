/**
 * VERIS Live Debrief: the post-interview, reviewable summary of a Live
 * interview.
 *
 *   evidence (deterministic)  overview, question coverage, screen-share sessions,
 *                             integrity & session observations (never sent to the AI)
 *   AI summary (stored)       competency coverage with transcript quotes,
 *                             strengths, areas to probe, unresolved questions,
 *                             evidence requiring review
 *   human evaluation          interviewers' submitted ratings (from the report),
 *                             the viewer's OWN private notes, the recruiter decision
 *
 * Rules:
 *   - The AI only sees the questions and the post-interview transcript. Never
 *     private notes, never interviewer ratings.
 *   - The AI never produces a hire/reject verdict or a score; anything that
 *     reads like one is dropped.
 *   - Every quote must be found in the transcript, or it is removed; a
 *     competency marked "strong" without a verified quote is downgraded.
 *   - Private notes are returned only to the interviewer who wrote them.
 */

import crypto from "node:crypto"

import { Prisma } from "@prisma/client"

import { openAiFetch } from "@/lib/server/ai-usage-log"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { getLiveInterviewReport } from "@/lib/server/services/live-interviews"
import { liveIntegrityEvidence } from "@/lib/server/services/live-signals"
import { getRecruiterDecisionsForInterviews } from "@/lib/server/services/recruiter-decisions"

type Report = Awaited<ReturnType<typeof getLiveInterviewReport>>
type TranscriptLine = Report["transcript"][number]

export type CoverageLevel = "STRONG" | "PARTIAL" | "NOT_DEMONSTRATED"
export type DebriefQuote = { quote: string; speaker: string | null; atMs: number | null }
export type DebriefPoint = { point: string; evidence: DebriefQuote[] }
export type DebriefSummary = {
  overview: string
  competencies: Array<{ name: string; level: CoverageLevel; note: string; evidence: DebriefQuote[] }>
  strengths: DebriefPoint[]
  areasToProbe: DebriefPoint[]
  unresolvedQuestions: string[]
  evidenceForReview: DebriefPoint[]
}

export const DEBRIEF_MODEL = "gpt-4o-mini"
const MAX_TRANSCRIPT_CHARS = 24_000

// ---------------------------------------------------------------------------
// Deterministic evidence

export function screenShareSessions(timeline: Report["timeline"], endedAt: string | null) {
  const sessions: Array<{ participant: string | null; startedAt: string; endedAt: string | null; seconds: number | null }> = []
  for (const event of timeline) {
    if (event.type === "SCREEN_SHARE_STARTED") {
      sessions.push({ participant: event.participant, startedAt: event.at, endedAt: null, seconds: null })
    } else if (event.type === "SCREEN_SHARE_STOPPED") {
      const open = [...sessions].reverse().find((s) => s.endedAt === null && s.participant === event.participant)
      if (open) {
        open.endedAt = event.at
        open.seconds = Math.max(0, Math.round((Date.parse(event.at) - Date.parse(open.startedAt)) / 1000))
      }
    }
  }
  // A share still open when the interview ended is closed at the end time.
  for (const session of sessions) {
    if (session.endedAt === null && endedAt) {
      session.endedAt = endedAt
      session.seconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000))
    }
  }
  return sessions
}

export function buildDebriefEvidence(report: Report) {
  const interview = report.interview
  const startedAt = interview.startedAt ? Date.parse(interview.startedAt) : null
  const endedAt = interview.endedAt ? Date.parse(interview.endedAt) : null
  const candidate = report.participants.find((p) => p.role === "CANDIDATE")
  const shares = screenShareSessions(report.timeline, interview.endedAt)

  return {
    overview: {
      candidate: candidate?.displayName ?? interview.candidateName ?? "Candidate",
      job: interview.jobTitle ?? null,
      interviewers: report.participants.filter((p) => p.role === "INTERVIEWER").map((p) => ({ name: p.displayName, panelRole: p.panelRole })),
      scheduledMinutes: interview.durationMinutes ?? null,
      actualMinutes: startedAt && endedAt ? Math.max(0, Math.round((endedAt - startedAt) / 60000)) : null,
      startedAt: interview.startedAt,
      endedAt: interview.endedAt,
      status: interview.liveStatus,
    },
    questions: {
      total: report.questions.length,
      covered: report.questions.filter((q) => q.status === "COVERED").length,
      skipped: report.questions.filter((q) => q.status === "SKIPPED").length,
      notAsked: report.questions.filter((q) => q.status === "NOT_ASKED").length,
      manual: report.manualQuestions.length,
    },
    screenShare: {
      sessions: shares,
      totalSeconds: shares.reduce((sum, s) => sum + (s.seconds ?? 0), 0),
    },
    transcriptLines: report.transcript.length,
    submittedScorecards: report.scorecards.filter((s) => s.submittedAt).length,
    integrity: liveIntegrityEvidence(report.timeline),
  }
}

/** Fingerprint of everything the AI summary is built from; a change marks the summary stale. */
export function debriefEvidenceDigest(report: Report) {
  const material = {
    questions: report.questions.map((q) => [q.questionId, q.text, q.status]),
    manual: report.manualQuestions.map((m) => m.text),
    transcript: report.transcript.map((t) => [t.speaker, t.startMs, t.text]),
  }
  return crypto.createHash("sha256").update(JSON.stringify(material)).digest("hex")
}

// ---------------------------------------------------------------------------
// Sanitising the AI output

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Finds the transcript line a quote came from; null when it isn't really in the transcript. */
export function locateQuote(quote: string, transcript: TranscriptLine[]): DebriefQuote | null {
  const needle = normalize(quote)
  if (needle.split(" ").length < 3) return null
  for (const line of transcript) {
    if (normalize(line.text).includes(needle)) {
      return { quote: quote.trim(), speaker: line.speaker, atMs: line.startMs }
    }
  }
  return null
}

// Hiring verdicts and scores are the recruiter's call, never the AI's.
const VERDICT_PATTERN =
  /\b(hire|hired|hiring decision|no[- ]hire|reject(ed|ion)? (the |this )?candidate|do not proceed|should (not )?(proceed|advance)|recommend(ed|s)? (to )?(hire|reject|advance|proceed)|strong (yes|no)|offer (the|an) (role|position|job))\b|\b\d+(\.\d+)?\s*(\/|out of)\s*(5|10|100)\b|\bscore(d|s)?\b/i

function hasVerdict(text: string) {
  return VERDICT_PATTERN.test(text)
}

function asString(value: unknown, max = 600) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function verifiedEvidence(raw: unknown, transcript: TranscriptLine[]) {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DebriefQuote[] = []
  for (const item of raw.slice(0, 4)) {
    const quote = asString(typeof item === "string" ? item : (item as { quote?: unknown })?.quote, 400)
    const located = quote ? locateQuote(quote, transcript) : null
    if (located && !seen.has(normalize(located.quote))) {
      seen.add(normalize(located.quote))
      out.push(located)
    }
  }
  return out
}

function points(raw: unknown, transcript: TranscriptLine[], limit = 5): DebriefPoint[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, limit)
    .map((item) => ({
      point: asString(typeof item === "string" ? item : (item as { point?: unknown })?.point),
      evidence: verifiedEvidence((item as { evidence?: unknown })?.evidence, transcript),
    }))
    .filter((item) => item.point && !hasVerdict(item.point))
}

export function sanitizeDebrief(raw: unknown, transcript: TranscriptLine[]): DebriefSummary {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const competencies = (Array.isArray(data.competencies) ? data.competencies : [])
    .slice(0, 12)
    .map((item) => {
      const c = (item ?? {}) as Record<string, unknown>
      const evidence = verifiedEvidence(c.evidence, transcript)
      let level: CoverageLevel = c.level === "STRONG" || c.level === "PARTIAL" ? c.level : "NOT_DEMONSTRATED"
      // "Strong" has to be backed by something the candidate actually said.
      if (level === "STRONG" && evidence.length === 0) level = "PARTIAL"
      return { name: asString(c.name, 120), level, note: asString(c.note), evidence }
    })
    .filter((c) => c.name && !hasVerdict(c.note))

  const overview = asString(data.overview, 900)
  return {
    overview: hasVerdict(overview) ? "" : overview,
    competencies,
    strengths: points(data.strengths, transcript),
    areasToProbe: points(data.areas_to_probe ?? data.areasToProbe, transcript),
    unresolvedQuestions: (Array.isArray(data.unresolved_questions ?? data.unresolvedQuestions) ? ((data.unresolved_questions ?? data.unresolvedQuestions) as unknown[]) : [])
      .slice(0, 6)
      .map((q) => asString(q, 300))
      .filter((q) => q && !hasVerdict(q)),
    evidenceForReview: points(data.evidence_for_review ?? data.evidenceForReview, transcript),
  }
}

// ---------------------------------------------------------------------------
// AI call

function clock(ms: number | null) {
  if (ms === null || ms === undefined) return "--:--"
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

export function transcriptForPrompt(transcript: TranscriptLine[]) {
  const lines = transcript.map((t) => `[${clock(t.startMs)}] ${t.speaker} (${t.role === "CANDIDATE" ? "Candidate" : "Interviewer"}): ${t.text}`)
  const full = lines.join("\n")
  if (full.length <= MAX_TRANSCRIPT_CHARS) return full
  // Keep the opening and the end of a long interview; mark the cut honestly.
  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2)
  return `${full.slice(0, half)}\n[... middle of the transcript omitted for length ...]\n${full.slice(-half)}`
}

export type DebriefAiFn = (input: { system: string; user: string }) => Promise<unknown>

export const openAiDebrief: DebriefAiFn = async ({ system, user }) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new ApiError(503, "OPENAI_UNAVAILABLE", "AI summaries are not configured.")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await openAiFetch("https://api.openai.com/v1/chat/completions", {
      aiUsage: { operation: "live.debrief" },
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEBRIEF_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    })
    if (!response.ok) throw new ApiError(502, "DEBRIEF_AI_FAILED", "The AI summary could not be generated. Please try again.")
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return JSON.parse(payload.choices?.[0]?.message?.content ?? "{}")
  } finally {
    clearTimeout(timeout)
  }
}

export function buildDebriefPrompt(report: Report) {
  const competencies = Array.from(
    new Set(report.questions.map((q) => q.focusArea).filter((v): v is string => Boolean(v)))
  )
  const system = [
    "You summarise a recorded, human-led job interview for the hiring team, as reviewable evidence.",
    "Use ONLY what the candidate actually said in the transcript. Do not invent facts.",
    "Every evidence quote must be copied word for word from the transcript (a short span of 6 to 30 words). Never paraphrase inside a quote.",
    "Never give a hiring verdict (hire, reject, proceed, advance, no-hire, offer) and never give scores, ratings or percentages. The recruiter decides.",
    "Do not comment on protected characteristics, appearance, accent, health or personal life.",
    "Return JSON with exactly these keys:",
    '{ "overview": string (2-3 neutral sentences on what was discussed),',
    '  "competencies": [{ "name": string, "level": "STRONG" | "PARTIAL" | "NOT_DEMONSTRATED", "note": string (one sentence), "evidence": [{ "quote": string }] }],',
    '  "strengths": [{ "point": string, "evidence": [{ "quote": string }] }],',
    '  "areas_to_probe": [{ "point": string, "evidence": [{ "quote": string }] }],',
    '  "unresolved_questions": [string],',
    '  "evidence_for_review": [{ "point": string, "evidence": [{ "quote": string }] }] }',
    "STRONG means the candidate gave a concrete, specific example; PARTIAL means it came up but without depth; NOT_DEMONSTRATED means it was not shown.",
    "unresolved_questions are open points a follow-up interview should cover. evidence_for_review are moments a human should look at closely (contradictions, vague or unsupported claims).",
    "Keep 2-4 items per list. Plain, factual language.",
  ].join("\n")

  const user = JSON.stringify({
    job_title: report.interview.jobTitle,
    competencies_to_assess: competencies.length ? competencies : "Infer 3-6 competencies from the questions.",
    planned_questions: report.questions.map((q) => ({ question: q.text, competency: q.focusArea, status: q.status })),
    follow_up_questions_asked: report.manualQuestions.map((m) => m.text),
    transcript: transcriptForPrompt(report.transcript),
  })
  return { system, user }
}

// ---------------------------------------------------------------------------
// Read / generate

type StoredDebrief = { summary: DebriefSummary; model: string | null; evidence_digest: string; generated_at: Date; generated_by: string | null }

async function storedDebrief(organizationId: string, interviewId: string) {
  const rows = await prisma.$queryRaw<StoredDebrief[]>(Prisma.sql`
    select summary, model, evidence_digest, generated_at, generated_by::text
    from public.live_interview_debriefs
    where organization_id = ${organizationId}::uuid and interview_id = ${interviewId}::uuid
  `)
  return rows[0] ?? null
}

/** The viewer's own private notes only: notes are never shown to anyone but their author. */
async function myPrivateNotes(organizationId: string, interviewId: string, userId: string) {
  const rows = await prisma.$queryRaw<Array<{ note_id: string; body: string; created_at: Date; question_order: number | null }>>(Prisma.sql`
    select n.note_id::text, n.body, n.created_at, q.question_order
    from public.live_interviewer_notes n
    join public.interview_participants p on p.participant_id = n.participant_id
    left join public.interview_questions q on q.interview_question_id = n.interview_question_id
    where n.organization_id = ${organizationId}::uuid
      and n.interview_id = ${interviewId}::uuid
      and p.user_id = ${userId}::uuid
    order by n.created_at
  `)
  return rows.map((r) => ({ noteId: r.note_id, body: r.body, createdAt: r.created_at.toISOString(), questionOrder: r.question_order }))
}

export async function getLiveDebrief(params: { organizationId: string; interviewId: string; userId: string }) {
  const report = await getLiveInterviewReport(params)
  const digest = debriefEvidenceDigest(report)
  const [stored, notes, decisions] = await Promise.all([
    storedDebrief(params.organizationId, params.interviewId),
    myPrivateNotes(params.organizationId, params.interviewId, params.userId),
    getRecruiterDecisionsForInterviews(params.organizationId, [params.interviewId]),
  ])
  const decision = decisions.get(params.interviewId) ?? null

  return {
    evidence: buildDebriefEvidence(report),
    summary: stored
      ? {
          ...stored.summary,
          generatedAt: stored.generated_at.toISOString(),
          model: stored.model,
          stale: stored.evidence_digest !== digest,
        }
      : null,
    canGenerate: report.interview.liveStatus === "COMPLETED" && report.transcript.length > 0,
    blockedReason:
      report.interview.liveStatus !== "COMPLETED"
        ? "The debrief is available once the interview has ended."
        : report.transcript.length === 0
          ? "Waiting for the transcript. It is ready a few minutes after a recorded interview ends."
          : null,
    myNotes: notes,
    candidateId: report.interview.candidateId,
    decision: decision
      ? { status: decision.status, notes: decision.notes ?? null, decidedAt: decision.decidedAt ? new Date(decision.decidedAt).toISOString() : null }
      : null,
  }
}

export async function generateLiveDebrief(params: {
  organizationId: string
  interviewId: string
  userId: string
  ai?: DebriefAiFn
}) {
  const report = await getLiveInterviewReport(params)
  if (report.interview.liveStatus !== "COMPLETED") {
    throw new ApiError(409, "DEBRIEF_NOT_READY", "The debrief is available once the interview has ended.")
  }
  if (report.transcript.length === 0) {
    throw new ApiError(409, "DEBRIEF_NO_TRANSCRIPT", "Waiting for the transcript. It is ready a few minutes after a recorded interview ends.")
  }

  const raw = await (params.ai ?? openAiDebrief)(buildDebriefPrompt(report))
  const summary = sanitizeDebrief(raw, report.transcript)
  const digest = debriefEvidenceDigest(report)

  await prisma.$executeRaw(Prisma.sql`
    insert into public.live_interview_debriefs (organization_id, interview_id, summary, model, evidence_digest, generated_by, generated_at)
    values (${params.organizationId}::uuid, ${params.interviewId}::uuid, ${JSON.stringify(summary)}::jsonb, ${DEBRIEF_MODEL}, ${digest}, ${params.userId}::uuid, now())
    on conflict (interview_id) do update
      set summary = excluded.summary, model = excluded.model, evidence_digest = excluded.evidence_digest,
          generated_by = excluded.generated_by, generated_at = excluded.generated_at
  `)
  return getLiveDebrief(params)
}
