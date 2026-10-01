import assert from "node:assert/strict"
import { test } from "node:test"

import { locateQuote, sanitizeDebrief, screenShareSessions, transcriptForPrompt } from "@/lib/server/services/live-debrief"

type Line = Parameters<typeof locateQuote>[1][number]

const transcript: Line[] = [
  { speaker: "Priya", role: "INTERVIEWER", startMs: 0, endMs: 4000, text: "Tell me about a backend service you built." },
  {
    speaker: "Casey",
    role: "CANDIDATE",
    startMs: 5000,
    endMs: 30000,
    text: "I built a Node.js order service that handled about two thousand requests per second, and I added retries with exponential backoff.",
  },
  { speaker: "Casey", role: "CANDIDATE", startMs: 31000, endMs: 40000, text: "We monitored it with Grafana dashboards and PagerDuty alerts." },
]

test("quotes must really be in the transcript, and are attributed to their speaker and time", () => {
  assert.deepEqual(locateQuote("handled about two thousand requests per second", transcript), {
    quote: "handled about two thousand requests per second",
    speaker: "Casey",
    atMs: 5000,
  })
  assert.equal(locateQuote("I led a team of fifty engineers at Google", transcript), null, "invented quote is rejected")
  assert.equal(locateQuote("Node.js", transcript), null, "too short to count as evidence")
  // Punctuation and curly quotes don't defeat matching.
  assert.ok(locateQuote("We monitored it with Grafana dashboards, and PagerDuty alerts", transcript))
  assert.ok(locateQuote("monitored it with Grafana dashboards and PagerDuty", transcript))
})

test("the AI summary is sanitised: no verdicts, no scores, unverified quotes dropped, 'strong' needs evidence", () => {
  const summary = sanitizeDebrief(
    {
      overview: "The candidate discussed a Node.js order service and its monitoring.",
      competencies: [
        { name: "Backend reliability", level: "STRONG", note: "Concrete example.", evidence: [{ quote: "I added retries with exponential backoff" }] },
        { name: "System design", level: "STRONG", note: "Claimed broad experience.", evidence: [{ quote: "designed the whole platform alone" }] },
        { name: "Leadership", level: "WHATEVER", note: "Not discussed.", evidence: [] },
        { name: "Overall", level: "STRONG", note: "We should hire this candidate.", evidence: [] },
      ],
      strengths: [
        { point: "Gave a specific throughput figure.", evidence: [{ quote: "handled about two thousand requests per second" }] },
        { point: "Strong yes from me", evidence: [] },
        { point: "Scored 8/10 on communication", evidence: [] },
      ],
      areas_to_probe: [{ point: "How alerts were tuned.", evidence: ["monitored it with Grafana dashboards and PagerDuty alerts"] }],
      unresolved_questions: ["What was their personal role versus the team's?", "Recommend to advance to the next round"],
      evidence_for_review: [{ point: "Throughput claim has no context on hardware.", evidence: [{ quote: "made up quote that is not present anywhere" }] }],
    },
    transcript
  )

  const byName = Object.fromEntries(summary.competencies.map((c) => [c.name, c]))
  assert.equal(byName["Backend reliability"].level, "STRONG")
  assert.equal(byName["Backend reliability"].evidence[0].speaker, "Casey")
  assert.equal(byName["System design"].level, "PARTIAL", "strong without a verified quote is downgraded")
  assert.equal(byName["System design"].evidence.length, 0)
  assert.equal(byName["Leadership"].level, "NOT_DEMONSTRATED", "unknown levels fall back safely")
  assert.equal(byName["Overall"], undefined, "a hiring verdict is removed")

  assert.deepEqual(summary.strengths.map((s) => s.point), ["Gave a specific throughput figure."])
  assert.equal(summary.areasToProbe[0].evidence.length, 1)
  assert.deepEqual(summary.unresolvedQuestions, ["What was their personal role versus the team's?"])
  assert.equal(summary.evidenceForReview[0].evidence.length, 0, "unverified quote removed, the point stays for a human to check")
})

test("screen-share sessions pair starts with stops, and an open share closes at the end of the interview", () => {
  const sessions = screenShareSessions(
    [
      { type: "SESSION_STARTED", participant: "Priya", at: "2026-10-01T10:00:00.000Z" },
      { type: "SCREEN_SHARE_STARTED", participant: "Casey", at: "2026-10-01T10:05:00.000Z" },
      { type: "SCREEN_SHARE_STOPPED", participant: "Casey", at: "2026-10-01T10:15:30.000Z" },
      { type: "SCREEN_SHARE_STARTED", participant: "Casey", at: "2026-10-01T10:20:00.000Z" },
    ],
    "2026-10-01T10:30:00.000Z"
  )
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].seconds, 630)
  assert.equal(sessions[1].endedAt, "2026-10-01T10:30:00.000Z")
  assert.equal(sessions[1].seconds, 600)
})

test("long transcripts are trimmed with an honest marker", () => {
  const long = Array.from({ length: 2000 }, (_, i): Line => ({ speaker: "Casey", role: "CANDIDATE", startMs: i * 1000, endMs: null, text: `answer number ${i} with some words` }))
  const text = transcriptForPrompt(long)
  assert.ok(text.length < 25_000)
  assert.ok(text.includes("middle of the transcript omitted"))
})
