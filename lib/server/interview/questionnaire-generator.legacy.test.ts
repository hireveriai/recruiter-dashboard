/**
 * Backward-compatibility guard: without a focus plan, the questionnaire and
 * resume generators must send byte-for-byte the same OpenAI request they
 * sent before Interview Focus existed. The golden file was recorded from the
 * pre-focus generator; regenerate it only for an intentional legacy change:
 *
 *   UPDATE_GOLDEN=1 npm run test:unit
 *
 * fetch is stubbed, so no network call is made.
 */

import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/questionnaire-legacy-requests.json")

type Captured = { operation: string; body: unknown }

async function captureRequests(run: () => Promise<unknown>) {
  const captured: Captured[] = []
  const originalFetch = globalThis.fetch
  const originalKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = "test-key"

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"))
    captured.push({ operation: body.response_format?.json_schema?.name ?? "unknown", body })
    const questions = Array.from({ length: 20 }, (_, i) => ({
      question_text: `How would you handle competing priorities in situation number ${i + 1} at work?`,
      source_type: "job",
      competency_label: "Prioritisation",
      difficulty_level: 3,
      phase_hint: "core",
      evaluation_criteria: "Gives a concrete example with a clear outcome.",
    }))
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }], usage: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENAI_API_KEY = originalKey
  }
  return captured
}

test("legacy generator requests are unchanged when no focus plan is supplied", async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused"
  const generator = await import("@/lib/server/interview/questionnaire-generator")

  const captured = await captureRequests(async () => {
    for (const durationMinutes of [30, 45, 60]) {
      await generator.generateStructuredQuestionnaire({
        jobTitle: "Senior Sales Manager",
        jobDescription: "Lead a regional team selling logistics services.",
        coreSkills: ["Negotiation", "Pipeline management"],
        experienceLevel: "Senior",
        durationMinutes,
        resumeQuestionsEnabled: true,
      })
    }
    await generator.generateStructuredQuestionnaire({
      jobTitle: "Teacher",
      jobDescription: "Teach mathematics",
      coreSkills: ["Lesson planning"],
      experienceLevel: "Mid",
      durationMinutes: 30,
      resumeQuestionsEnabled: false,
      excludeQuestions: ["How do you plan a lesson?"],
    })
    await generator.generateResumeQuestions({
      jobTitle: "Teacher",
      jobDescription: "Teach mathematics",
      experienceLevel: "Mid",
      candidateBackground: "Mathematics teacher for six years, led the department intervention programme.",
      questionCount: 2,
    })
  })

  if (process.env.UPDATE_GOLDEN === "1") {
    writeFileSync(GOLDEN, `${JSON.stringify(captured, null, 2)}\n`)
  }

  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"))
  assert.deepEqual(captured, golden)
})
