/**
 * Interview Focus -> questionnaire generation, versioning and snapshots,
 * against a real Postgres (throwaway database). OpenAI is stubbed: responses
 * are dispatched by JSON schema name and follow the focus targets in the
 * prompt, so no network call is made. Skips without TEST_DATABASE_URL.
 */

import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import { createFocusTestDatabase, useTestDatabaseForPrisma } from "../../../test/support/focus-test-database.ts"

const db = await createFocusTestDatabase()
const suite = db ? test : test.skip

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

let focusSvc: typeof import("@/lib/server/services/interview-focus")
let applySvc: typeof import("@/lib/server/services/interview-focus-questionnaire")
let questionnaire: typeof import("@/lib/server/services/job-questionnaire")
let prepare: typeof import("@/lib/server/interview/prepare-questions")
let prismaModule: typeof import("@/lib/server/prisma")
let openAiCalls: string[] = []
const originalFetch = globalThis.fetch

let salesJob: string
let teacherJob: string

type Row = Record<string, unknown>

async function q<T extends Row = Row>(sql: string, params: unknown[] = []) {
  return (await db!.pool.query<T>(sql, params)).rows
}

async function insertJob(org: string, title: string, level: number, duration: number, mode: "STANDARD" | "INDIVIDUALIZED") {
  const rows = await q<{ job_id: string }>(
    `insert into public.job_positions (organization_id, job_title, job_description, experience_level_id, core_skills, interview_duration_minutes, interview_mode)
     values ($1, $2, $3, $4, $5, $6, $7) returning job_id::text`,
    [org, title, `${title} description`, level, ["Planning"], duration, mode]
  )
  return rows[0].job_id
}

async function insertInterview(org: string, jobId: string) {
  const rows = await q<{ interview_id: string }>(
    `insert into public.interviews (organization_id, job_id) values ($1, $2) returning interview_id::text`,
    [org, jobId]
  )
  return rows[0].interview_id
}

function fakeQuestion(i: number, extra: Row) {
  return {
    question_text: `How did you handle a demanding situation at work involving case number ${i}?`,
    competency_label: "Aspect",
    evaluation_criteria: "Concrete example with a clear outcome.",
    ...extra,
  }
}

/** Stubbed OpenAI: answers each call according to what the prompt asks for. */
function stubOpenAi() {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    const name = body.response_format?.json_schema?.name as string
    const user = body.messages.find((m: { role: string }) => m.role === "user").content as string
    openAiCalls.push(name)
    let content: unknown

    if (name === "interview_focus") {
      content = {
        competencies: [
          { key: "commercial_awareness", weight: 35, rationale: "Owns revenue." },
          { key: "communication", weight: 25, rationale: "Client conversations." },
          { key: "customer_focus", weight: 20, rationale: "Key accounts." },
          { key: "leadership", weight: 20, rationale: "Leads a team." },
        ],
      }
    } else if (name === "interview_questionnaire") {
      const total = Number(/Produce exactly (\d+) question/.exec(user)![1])
      const keys: string[] = []
      for (const m of user.matchAll(/(\d+) with focus_area_key "([a-z0-9_]+)"/g)) {
        for (let i = 0; i < Number(m[1]); i += 1) keys.push(m[2])
      }
      const offset = openAiCalls.length * 100
      content = {
        questions: Array.from({ length: total }, (_, i) =>
          fakeQuestion(offset + i, {
            source_type: "job",
            difficulty_level: 3,
            phase_hint: "core",
            ...(keys.length ? { focus_area_key: keys[i] } : {}),
          })
        ),
      }
    } else {
      const total = Number(/Produce exactly (\d+) question/.exec(user)![1])
      const firstKey = /"key": "([a-z0-9_]+)"/.exec(user)?.[1]
      content = {
        questions: Array.from({ length: total }, (_, i) =>
          fakeQuestion(9000 + openAiCalls.length * 10 + i, firstKey ? { focus_area_key: firstKey } : {})
        ),
      }
    }

    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: {} }), { status: 200 })
  }) as typeof fetch
}

before(async () => {
  if (!db) return
  useTestDatabaseForPrisma(db.url)
  process.env.INTERVIEW_FOCUS_ENABLED = "true"
  delete process.env.INTERVIEW_FOCUS_ORG_IDS
  process.env.OPENAI_API_KEY = "test-key"
  stubOpenAi()
  focusSvc = await import("@/lib/server/services/interview-focus")
  applySvc = await import("@/lib/server/services/interview-focus-questionnaire")
  questionnaire = await import("@/lib/server/services/job-questionnaire")
  prepare = await import("@/lib/server/interview/prepare-questions")
  prismaModule = await import("@/lib/server/prisma")
  salesJob = await insertJob(ORG_A, "Senior Sales Manager", 4, 45, "STANDARD")
  teacherJob = await insertJob(ORG_A, "Mathematics Teacher", 3, 30, "INDIVIDUALIZED")
})

after(async () => {
  globalThis.fetch = originalFetch
  if (!db) return
  await prismaModule?.prisma.$disconnect()
  await db.drop()
})

suite("first questionnaire creates the VERIS Recommended plan and records its exact version", async () => {
  openAiCalls = []
  const { version, generated } = await questionnaire.ensureFinalizedQuestionnaireVersion({ organizationId: ORG_A, jobId: salesJob })
  assert.equal(generated, true)
  assert.deepEqual(openAiCalls, ["interview_focus", "interview_questionnaire"], "one recommendation + one generation")

  const plan = (await focusSvc.getFocusPlans({ organizationId: ORG_A, jobId: salesJob })).active!
  assert.equal(plan.recommendation?.source, "ai")
  assert.equal(version.focus_plan_id, plan.planId)

  const [meta] = await q<{ generation_meta: Row }>(`select generation_meta from job_questionnaire_versions where questionnaire_version_id = $1`, [version.questionnaire_version_id])
  assert.equal(meta.generation_meta.focusPlanVersion, 1)

  const rows = await q<{ focus_area_key: string }>(`select focus_area_key from job_questionnaire_questions where questionnaire_version_id = $1 order by question_order`, [version.questionnaire_version_id])
  const allocation = meta.generation_meta.focusAllocation as Array<{ areaKey: string; questions: number }>
  for (const area of allocation) {
    assert.equal(rows.filter((r) => r.focus_area_key === area.areaKey).length, area.questions, area.areaKey)
  }
  assert.equal(rows.length, allocation.reduce((s, a) => s + a.questions, 0))
})

let firstInterview: string
let firstVersionId: string
let firstPlanId: string

suite("a STANDARD interview snapshot carries the focus area and plan in reference_context", async () => {
  firstInterview = await insertInterview(ORG_A, salesJob)
  const result = await prepare.prepareInterviewQuestionSet({
    organizationId: ORG_A,
    jobId: salesJob,
    interviewId: firstInterview,
    candidateBackground: "Regional sales lead for six years who recovered two at-risk enterprise accounts.",
  })
  firstVersionId = result.questionnaireVersionId!
  firstPlanId = (await focusSvc.getFocusPlans({ organizationId: ORG_A, jobId: salesJob })).active!.planId

  const rows = await q<{ source_type: string; reference_context: Row }>(
    `select source_type, reference_context from interview_questions where interview_id = $1 order by question_order`,
    [firstInterview]
  )
  const core = rows.filter((r) => r.reference_context.source === "job_questionnaire")
  assert.ok(core.length > 0)
  for (const row of core) {
    assert.equal(row.reference_context.focus_plan_id, firstPlanId)
    assert.ok(typeof row.reference_context.focus_area_key === "string")
    assert.ok("anchor" in row.reference_context && "evaluation_criteria" in row.reference_context, "legacy keys intact")
  }
  const resume = rows.filter((r) => r.source_type === "resume")
  assert.equal(resume.length, result.resumeQuestionCount)
  assert.ok(resume.every((r) => typeof r.reference_context.focus_area_key === "string"))
})

suite("tenant isolation: another organization cannot apply focus to the job", async () => {
  await assert.rejects(applySvc.applyFocusAndRegenerate({ organizationId: ORG_B, jobId: salesJob }), { code: "JOB_NOT_FOUND" })
})

suite("applying a focus change creates a NEW draft questionnaire; the finalized one and existing interviews are untouched", async () => {
  const before = await q(`select questionnaire_question_id, question_text, focus_area_key from job_questionnaire_questions where questionnaire_version_id = $1 order by question_order`, [firstVersionId])
  const snapshotBefore = await q(`select question_text, reference_context from interview_questions where interview_id = $1 order by question_order`, [firstInterview])

  await focusSvc.saveFocusDraft({
    organizationId: ORG_A,
    jobId: salesJob,
    resumeEmphasis: "HEAVY",
    areas: [
      { areaKey: "commercial_awareness", coverageWeight: 40 },
      { label: "Key Account Negotiation", coverageWeight: 35 },
      { areaKey: "judgement", coverageWeight: 25 },
    ],
  })

  openAiCalls = []
  const applied = await applySvc.applyFocusAndRegenerate({ organizationId: ORG_A, jobId: salesJob, idempotencyKey: "apply-1" })
  assert.deepEqual(openAiCalls, ["interview_questionnaire"])
  assert.equal(applied.focusPlanVersion, 2)
  assert.equal(applied.generationAttempts, 1)

  // Idempotent retry: no second generation, same answer.
  openAiCalls = []
  const replay = await applySvc.applyFocusAndRegenerate({ organizationId: ORG_A, jobId: salesJob, idempotencyKey: "apply-1" }).catch((e) => e)
  assert.ok(openAiCalls.length === 0, "no AI call on replay")
  assert.ok(replay.questionnaireVersionNumber === applied.questionnaireVersionNumber || replay.code === "NO_FOCUS_DRAFT")

  const versions = await q<{ version_number: number; status: string; focus_plan_id: string }>(
    `select v.version_number, v.status, v.focus_plan_id::text from job_questionnaire_versions v
     join job_questionnaires jq on jq.questionnaire_id = v.questionnaire_id where jq.job_id = $1 order by v.version_number`,
    [salesJob]
  )
  const plans = await q<{ plan_id: string; version_number: number; status: string }>(
    `select plan_id::text, version_number, status from interview_focus_plans where job_id = $1 order by version_number`,
    [salesJob]
  )
  assert.deepEqual(plans.map((p) => p.status), ["SUPERSEDED", "ACTIVE"])
  assert.equal(versions[0].status, "FINALIZED")
  assert.equal(versions[0].focus_plan_id, plans[0].plan_id, "finalized keeps the plan that generated it")
  assert.equal(versions.at(-1)!.status, "DRAFT")
  assert.equal(versions.at(-1)!.focus_plan_id, plans[1].plan_id, "draft references the exact new plan version")

  const draftKeys = await q<{ focus_area_key: string }>(
    `select focus_area_key from job_questionnaire_questions q join job_questionnaire_versions v on v.questionnaire_version_id = q.questionnaire_version_id
     join job_questionnaires jq on jq.questionnaire_id = v.questionnaire_id where jq.job_id = $1 and v.status = 'DRAFT'`,
    [salesJob]
  )
  assert.ok(draftKeys.some((r) => r.focus_area_key === "custom_key_account_negotiation"))

  assert.deepEqual(await q(`select questionnaire_question_id, question_text, focus_area_key from job_questionnaire_questions where questionnaire_version_id = $1 order by question_order`, [firstVersionId]), before)
  assert.deepEqual(await q(`select question_text, reference_context from interview_questions where interview_id = $1 order by question_order`, [firstInterview]), snapshotBefore)
})

suite("new interviews use the new focus only after the draft is finalized", async () => {
  const beforeFinalize = await insertInterview(ORG_A, salesJob)
  const r1 = await prepare.prepareInterviewQuestionSet({ organizationId: ORG_A, jobId: salesJob, interviewId: beforeFinalize, candidateBackground: "x".repeat(60) })
  assert.equal(r1.questionnaireVersionId, firstVersionId, "still the finalized v1")
  assert.equal(r1.resumeQuestionCount, 2, "resume emphasis follows the plan v1 used (STANDARD), not the new ACTIVE plan")

  await questionnaire.finalizeQuestionnaireDraft({ organizationId: ORG_A, jobId: salesJob })
  const afterFinalize = await insertInterview(ORG_A, salesJob)
  const r2 = await prepare.prepareInterviewQuestionSet({ organizationId: ORG_A, jobId: salesJob, interviewId: afterFinalize, candidateBackground: "x".repeat(60) })
  assert.notEqual(r2.questionnaireVersionId, firstVersionId)
  assert.equal(r2.resumeQuestionCount, 4, "HEAVY resume emphasis for a 45-minute interview")
  assert.equal(r2.structuredQuestionCount + r2.resumeQuestionCount, 12, "45-minute total unchanged")

  const [row] = await q<{ reference_context: Row }>(`select reference_context from interview_questions where interview_id = $1 and reference_context->>'source' = 'job_questionnaire' limit 1`, [afterFinalize])
  const activePlan = (await focusSvc.getFocusPlans({ organizationId: ORG_A, jobId: salesJob })).active!
  assert.equal(row.reference_context.focus_plan_id, activePlan.planId)
})

suite("a recruiter's manual edit of a finalized questionnaire keeps its focus provenance", async () => {
  const current = await questionnaire.getQuestionnaireForEditing({ organizationId: ORG_A, jobId: salesJob })
  const edited = current.questions.map((row) => ({
    questionnaireQuestionId: row.questionnaire_question_id,
    questionText: row.question_text,
    sourceType: row.source_type,
    competencyLabel: row.competency_label,
    evaluationCriteria: row.evaluation_criteria,
    difficultyLevel: row.difficulty_level,
    phaseHint: row.phase_hint,
    questionType: row.question_type,
    origin: row.origin,
    focusAreaKey: row.focus_area_key,
  }))
  edited[0].questionText = "What would you do first when a key account threatens to leave at renewal?"
  const saved = await questionnaire.saveQuestionnaireDraft({ organizationId: ORG_A, jobId: salesJob, questions: edited })
  const [draft] = await q<{ focus_plan_id: string }>(`select focus_plan_id::text from job_questionnaire_versions where questionnaire_version_id = $1`, [saved.version.questionnaire_version_id])
  assert.equal(draft.focus_plan_id, current.version.focus_plan_id, "inherited from the finalized version")
  const keys = await questionnaire.getVersionQuestions(ORG_A, saved.version.questionnaire_version_id)
  assert.deepEqual(keys.map((k) => k.focus_area_key), edited.map((e) => e.focusAreaKey), "question focus keys preserved")
  await questionnaire.discardQuestionnaireDraft({ organizationId: ORG_A, jobId: salesJob })
})

suite("INDIVIDUALIZED interviews generate from the ACTIVE plan with its resume emphasis", async () => {
  await focusSvc.ensureActiveFocusPlan({ organizationId: ORG_A, jobId: teacherJob })
  await focusSvc.saveFocusDraft({
    organizationId: ORG_A,
    jobId: teacherJob,
    resumeEmphasis: "OFF",
    areas: [{ areaKey: "role_knowledge", coverageWeight: 60 }, { areaKey: "communication", coverageWeight: 40 }],
  })
  await focusSvc.activateFocusDraft({ organizationId: ORG_A, jobId: teacherJob })

  const interview = await insertInterview(ORG_A, teacherJob)
  const result = await prepare.prepareInterviewQuestionSet({ organizationId: ORG_A, jobId: teacherJob, interviewId: interview, candidateBackground: "Maths teacher for six years with strong results." })
  assert.equal(result.mode, "INDIVIDUALIZED")
  assert.equal(result.resumeQuestionCount, 0, "resume emphasis OFF")
  assert.equal(result.structuredQuestionCount, 8, "30-minute interview keeps all 8 slots")
  const keys = await q<{ key: string }>(`select reference_context->>'focus_area_key' as key from interview_questions where interview_id = $1`, [interview])
  assert.equal(keys.filter((k) => k.key === "role_knowledge").length, 5)
  assert.equal(keys.filter((k) => k.key === "communication").length, 3)
})

suite("flag off: the legacy path is used - no plan, no provenance, legacy JSON", async () => {
  process.env.INTERVIEW_FOCUS_ENABLED = "false"
  try {
    const legacyJob = await insertJob(ORG_A, "Operations Manager", 4, 60, "STANDARD")
    openAiCalls = []
    const { version } = await questionnaire.ensureFinalizedQuestionnaireVersion({ organizationId: ORG_A, jobId: legacyJob })
    assert.deepEqual(openAiCalls, ["interview_questionnaire"], "no recommendation call")
    assert.equal(version.focus_plan_id, null)
    assert.deepEqual(await q(`select 1 from interview_focus_plans where job_id = $1`, [legacyJob]), [])

    const interview = await insertInterview(ORG_A, legacyJob)
    await prepare.prepareInterviewQuestionSet({ organizationId: ORG_A, jobId: legacyJob, interviewId: interview, candidateBackground: "x".repeat(60) })
    const contexts = await q<{ reference_context: Row }>(`select reference_context from interview_questions where interview_id = $1`, [interview])
    for (const row of contexts) {
      assert.ok(!("focus_area_key" in row.reference_context) && !("focus_plan_id" in row.reference_context))
    }
    const tagged = await q(`select 1 from job_questionnaire_questions where questionnaire_version_id = $1 and focus_area_key is not null`, [version.questionnaire_version_id])
    assert.equal(tagged.length, 0)
  } finally {
    process.env.INTERVIEW_FOCUS_ENABLED = "true"
  }
})

suite("regression: Regenerate All from a FINALIZED questionnaire forks a draft (reserve attempt)", async () => {
  const job = await insertJob(ORG_A, "Product Manager", 3, 45, "INDIVIDUALIZED")
  const { version } = await questionnaire.ensureFinalizedQuestionnaireVersion({ organizationId: ORG_A, jobId: job })
  assert.equal(version.status, "FINALIZED")
  const reservation = await questionnaire.reserveInterviewGenerationAttempt({ organizationId: ORG_A, jobId: job, current: version })
  const [draft] = await q<{ status: string; interview_mode: string; generation_attempts: number }>(
    `select status, interview_mode, generation_attempts from job_questionnaire_versions where questionnaire_version_id = $1`,
    [reservation.versionId]
  )
  assert.deepEqual(draft, { status: "DRAFT", interview_mode: "INDIVIDUALIZED", generation_attempts: 1 })
  const [finalized] = await q<{ status: string }>(`select status from job_questionnaire_versions where questionnaire_version_id = $1`, [version.questionnaire_version_id])
  assert.equal(finalized.status, "FINALIZED", "finalized version untouched")
})
