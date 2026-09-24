/**
 * Focus-aware generation with a stubbed OpenAI (no network).
 */

import assert from "node:assert/strict"
import test from "node:test"

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused"

const generator = await import("@/lib/server/interview/questionnaire-generator")

const AREAS = [
  { areaKey: "commercial_awareness", label: "Commercial Awareness", description: "How work creates value.", sortOrder: 1, coverageWeight: 30 },
  { areaKey: "communication", label: "Communication", description: "Explaining clearly.", sortOrder: 2, coverageWeight: 25 },
  { areaKey: "customer_focus", label: "Customer & Service Focus", description: "Serving customers.", sortOrder: 3, coverageWeight: 20 },
  { areaKey: "stakeholder_management", label: "Stakeholder Management", description: "Managing expectations.", sortOrder: 4, coverageWeight: 15 },
  { areaKey: "custom_key_account_negotiation", label: "Key Account Negotiation", description: null, sortOrder: 5, coverageWeight: 10 },
]

type Body = { messages: Array<{ role: string; content: string }>; response_format: { json_schema: { name: string; schema: any } } }

function question(i: number, focusKey: string | null, extra: Record<string, unknown> = {}) {
  return {
    question_text: `How did you handle a difficult negotiation with an important client in case ${i}?`,
    source_type: "job",
    competency_label: "Negotiation",
    difficulty_level: 3,
    phase_hint: "core",
    evaluation_criteria: "Explains the approach and a clear commercial outcome.",
    ...(focusKey === null ? {} : { focus_area_key: focusKey }),
    ...extra,
  }
}

/** Builds a response that follows (or ignores) the targets in the prompt. */
function questionsFor(body: Body, mode: "follow" | "ignore" | "unknown") {
  const user = body.messages.find((m) => m.role === "user")!.content
  const total = Number(/Produce exactly (\d+) question/.exec(user)![1])
  const targets = [...user.matchAll(/(\d+) with focus_area_key "([a-z0-9_]+)"/g)].map((m) => ({ key: m[2], n: Number(m[1]) }))
  const keys: string[] = []
  for (const target of targets) for (let i = 0; i < target.n; i += 1) keys.push(target.key)
  return Array.from({ length: total }, (_, i) =>
    question(i + 1, mode === "follow" ? keys[i] : mode === "unknown" ? "hacked_key" : targets[0].key)
  )
}

async function withStub(responder: (body: Body, call: number) => unknown[], run: () => Promise<unknown>) {
  const bodies: Body[] = []
  const originalFetch = globalThis.fetch
  const originalKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = "test-key"
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body
    bodies.push(body)
    const questions = responder(body, bodies.length)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }], usage: {} }), { status: 200 })
  }) as typeof fetch
  try {
    return { result: await run(), bodies }
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENAI_API_KEY = originalKey
  }
}

const base = {
  jobTitle: "Senior Sales Manager",
  jobDescription: "Lead a regional sales team.",
  coreSkills: ["Negotiation"],
  experienceLevel: "Senior",
  resumeQuestionsEnabled: true,
}

test("focus: request carries the allocation, a key-restricted schema and the focus rules", async () => {
  const { result, bodies } = await withStub((body) => questionsFor(body, "follow"), () =>
    generator.generateStructuredQuestionnaire({ ...base, durationMinutes: 45, focusAreas: AREAS })
  )
  const res = result as Awaited<ReturnType<typeof generator.generateStructuredQuestionnaire>>
  const body = bodies[0]
  const item = body.response_format.json_schema.schema.properties.questions.items

  assert.deepEqual(item.properties.focus_area_key.enum, AREAS.map((a) => a.areaKey))
  assert.ok(item.required.includes("focus_area_key"))
  assert.match(body.messages[0].content, /FOCUS AREAS/)
  assert.match(body.messages[0].content, /never a reason to introduce vocabulary from another field/)

  const allocation = res.focusAllocation!
  assert.equal(allocation.reduce((s, a) => s + a.questions, 0), res.plan.structuredQuestionCount)
  assert.ok(allocation.every((a) => a.questions >= 1))
  assert.equal(res.openAiCalls, 1)
  assert.equal(res.usedFallback, false)
  assert.equal(generator.focusAllocationDeviation(res.questions, allocation), 0)
  for (const q of res.questions) assert.ok(AREAS.some((a) => a.areaKey === q.focusAreaKey))
})

test("focus: coverage targets follow duration (30/45/60) and never exceed the structured count", async () => {
  for (const durationMinutes of [30, 45, 60]) {
    const { result } = await withStub((body) => questionsFor(body, "follow"), () =>
      generator.generateStructuredQuestionnaire({ ...base, durationMinutes, focusAreas: AREAS })
    )
    const res = result as Awaited<ReturnType<typeof generator.generateStructuredQuestionnaire>>
    assert.equal(res.plan.totalQuestions, { 30: 8, 45: 12, 60: 15 }[durationMinutes])
    assert.equal(res.focusAllocation!.reduce((s, a) => s + a.questions, 0), res.plan.structuredQuestionCount)
    const counts = res.focusAllocation!.map((a) => a.questions)
    for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i - 1] >= counts[i], `heavier areas get at least as many: ${counts}`)
  }
})

test("focus: resume emphasis changes the structured/resume split, not the total", async () => {
  const run = async (resumeEmphasis: "OFF" | "HEAVY") => {
    const { result } = await withStub((body) => questionsFor(body, "follow"), () =>
      generator.generateStructuredQuestionnaire({ ...base, durationMinutes: 60, focusAreas: AREAS, resumeEmphasis })
    )
    return (result as Awaited<ReturnType<typeof generator.generateStructuredQuestionnaire>>).plan
  }
  const off = await run("OFF")
  const heavy = await run("HEAVY")
  assert.equal(off.resumeQuestionCount, 0)
  assert.equal(heavy.resumeQuestionCount, 4)
  assert.equal(off.structuredQuestionCount + off.resumeQuestionCount, heavy.structuredQuestionCount + heavy.resumeQuestionCount)
})

test("focus: unknown keys are never stored and a missed allocation gets exactly one retry", async () => {
  const { result, bodies } = await withStub((body, call) => questionsFor(body, call === 1 ? "unknown" : "follow"), () =>
    generator.generateStructuredQuestionnaire({ ...base, durationMinutes: 30, focusAreas: AREAS })
  )
  const res = result as Awaited<ReturnType<typeof generator.generateStructuredQuestionnaire>>
  assert.equal(bodies.length, 2)
  assert.equal(res.openAiCalls, 2)
  assert.equal(generator.focusAllocationDeviation(res.questions, res.focusAllocation!), 0)
  assert.ok(res.questions.every((q) => q.focusAreaKey !== "hacked_key"))
})

test("focus: when both attempts miss, the closest set is kept and marked as fallback", async () => {
  const { result } = await withStub((body) => questionsFor(body, "ignore"), () =>
    generator.generateStructuredQuestionnaire({ ...base, durationMinutes: 30, focusAreas: AREAS })
  )
  const res = result as Awaited<ReturnType<typeof generator.generateStructuredQuestionnaire>>
  assert.equal(res.openAiCalls, 2)
  assert.equal(res.usedFallback, true)
  assert.ok(res.questions.length >= res.plan.minQuestions, "a usable questionnaire is still returned")
})

test("focus: a plan saved for 60 minutes is trimmed for a 30 minute interview", async () => {
  const seven = [
    ...AREAS.map((a) => ({ ...a, coverageWeight: 10 })),
    { areaKey: "judgement", label: "Judgement", description: null, sortOrder: 6, coverageWeight: 25 },
    { areaKey: "ownership", label: "Ownership", description: null, sortOrder: 7, coverageWeight: 25 },
  ]
  const { result } = await withStub((body) => questionsFor(body, "follow"), () =>
    generator.generateStructuredQuestionnaire({ ...base, durationMinutes: 30, focusAreas: seven })
  )
  const res = result as Awaited<ReturnType<typeof generator.generateStructuredQuestionnaire>>
  assert.equal(res.focusAllocation!.length, 5)
  assert.ok(res.focusAllocation!.some((a) => a.areaKey === "judgement"))
  assert.ok(res.focusAllocation!.some((a) => a.areaKey === "ownership"))
})

test("focus: resume questions are tagged with a plan area and never an unknown one", async () => {
  const { result, bodies } = await withStub(
    () => [
      { question_text: "What was the hardest renegotiation you led, and what changed as a result?", competency_label: "Negotiation", evaluation_criteria: "x", focus_area_key: "custom_key_account_negotiation" },
      { question_text: "How did you rebuild trust with a client after a missed delivery date?", competency_label: "Trust", evaluation_criteria: "y", focus_area_key: "made_up" },
    ],
    () =>
      generator.generateResumeQuestions({
        jobTitle: "Senior Sales Manager",
        candidateBackground: "Regional sales lead for six years; recovered two at-risk enterprise accounts.",
        questionCount: 2,
        focusAreas: AREAS,
      })
  )
  const res = result as { questions: Array<{ focusAreaKey?: string | null }> }
  assert.deepEqual(res.questions.map((q) => q.focusAreaKey), ["custom_key_account_negotiation", null])
  assert.deepEqual(bodies[0].response_format.json_schema.schema.properties.questions.items.properties.focus_area_key.enum, AREAS.map((a) => a.areaKey))
})

test("no focus areas: result carries no allocation and questions carry no focus key", async () => {
  const { result } = await withStub((body) => {
    const total = Number(/Produce exactly (\d+) question/.exec(body.messages[1].content)![1])
    return Array.from({ length: total }, (_, i) => question(i + 1, null))
  }, () => generator.generateStructuredQuestionnaire({ ...base, durationMinutes: 30, focusAreas: [] }))
  const res = result as Awaited<ReturnType<typeof generator.generateStructuredQuestionnaire>>
  assert.equal(res.focusAllocation, null)
  assert.ok(res.questions.every((q) => !("focusAreaKey" in q)))
})

test("focus: HEAVY resume emphasis does not force a retry just because fewer structured slots remain", async () => {
  const { result, bodies } = await withStub((body) => questionsFor(body, "follow"), () =>
    generator.generateStructuredQuestionnaire({ ...base, durationMinutes: 45, focusAreas: AREAS, resumeEmphasis: "HEAVY" })
  )
  const res = result as Awaited<ReturnType<typeof generator.generateStructuredQuestionnaire>>
  assert.equal(res.plan.structuredQuestionCount, 8)
  assert.equal(bodies.length, 1, "one call on the happy path")
  assert.equal(res.usedFallback, false)
})
