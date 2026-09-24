/**
 * Interview Focus plan lifecycle against a real Postgres (throwaway database;
 * see test/support/focus-test-database.ts). Skips without TEST_DATABASE_URL.
 *
 * The AI is disabled (no OPENAI_API_KEY) so recommendations come from the
 * deterministic fallback and no network call is made.
 */

import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import { createFocusTestDatabase, useTestDatabaseForPrisma } from "../../../test/support/focus-test-database.ts"

const db = await createFocusTestDatabase()
const suite = db ? test : test.skip

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

let svc: typeof import("@/lib/server/services/interview-focus")
let prismaModule: typeof import("@/lib/server/prisma")
let teacherJob: string
let salesJob: string

async function insertJob(org: string, title: string, level: number, duration: number) {
  const { rows } = await db!.pool.query<{ job_id: string }>(
    `insert into public.job_positions (organization_id, job_title, job_description, experience_level_id, core_skills, interview_duration_minutes, interview_mode)
     values ($1, $2, $3, $4, $5, $6, 'STANDARD') returning job_id::text`,
    [org, title, `${title} role description`, level, ["Planning", "Communication"], duration]
  )
  return rows[0].job_id
}

async function planRows(jobId: string) {
  const { rows } = await db!.pool.query<{ version_number: number; status: string; origin: string; resume_emphasis: string }>(
    `select version_number, status, origin, resume_emphasis from public.interview_focus_plans where job_id = $1 order by version_number`,
    [jobId]
  )
  return rows
}

before(async () => {
  if (!db) return
  useTestDatabaseForPrisma(db.url)
  process.env.INTERVIEW_FOCUS_ENABLED = "true"
  delete process.env.INTERVIEW_FOCUS_ORG_IDS
  process.env.OPENAI_API_KEY = ""
  svc = await import("@/lib/server/services/interview-focus")
  prismaModule = await import("@/lib/server/prisma")
  teacherJob = await insertJob(ORG_A, "Teacher", 3, 30)
  salesJob = await insertJob(ORG_B, "Sales Manager", 4, 60)
})

after(async () => {
  if (!db) return
  await prismaModule?.prisma.$disconnect()
  await db.drop()
})

suite("first use creates one ACTIVE VERIS Recommended plan, even under concurrency", async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, () => svc.ensureActiveFocusPlan({ organizationId: ORG_A, jobId: teacherJob, createdBy: USER }))
  )
  assert.equal(results.filter((r) => r.created).length, 1)
  assert.equal(new Set(results.map((r) => r.plan.planId)).size, 1)

  const plan = results[0].plan
  assert.equal(plan.status, "ACTIVE")
  assert.equal(plan.origin, "VERIS_RECOMMENDED")
  assert.equal(plan.versionNumber, 1)
  assert.ok(plan.areas.length >= 4 && plan.areas.length <= 5, "30-minute limit")
  assert.equal(plan.areas.reduce((s, a) => s + a.coverageWeight, 0), 100)
  assert.equal(plan.recommendation?.source, "fallback")
  assert.deepEqual(await planRows(teacherJob), [{ version_number: 1, status: "ACTIVE", origin: "VERIS_RECOMMENDED", resume_emphasis: "STANDARD" }])
})

suite("tenant isolation: another organization cannot read or change the job's focus", async () => {
  await assert.rejects(svc.getFocusPlans({ organizationId: ORG_B, jobId: teacherJob }), { code: "JOB_NOT_FOUND" })
  await assert.rejects(svc.ensureActiveFocusPlan({ organizationId: ORG_B, jobId: teacherJob }), { code: "JOB_NOT_FOUND" })
  await assert.rejects(
    svc.saveFocusDraft({ organizationId: ORG_B, jobId: teacherJob, areas: [{ areaKey: "communication", coverageWeight: 100 }], resumeEmphasis: "OFF" }),
    { code: "JOB_NOT_FOUND" }
  )
  await assert.rejects(svc.discardFocusDraft({ organizationId: ORG_B, jobId: teacherJob }), { code: "JOB_NOT_FOUND" })
  await assert.rejects(svc.activateFocusDraft({ organizationId: ORG_B, jobId: teacherJob }), { code: "JOB_NOT_FOUND" })

  const active = (await svc.getFocusPlans({ organizationId: ORG_A, jobId: teacherJob })).active!
  assert.equal(await svc.getFocusPlanById(ORG_B, active.planId), null, "plan lookup is org-scoped")
})

suite("tenant isolation: the database rejects cross-organization rows", async () => {
  await assert.rejects(
    db!.pool.query(
      `insert into public.interview_focus_plans (organization_id, job_id, version_number) values ($1, $2, 99)`,
      [ORG_B, teacherJob]
    ),
    /FOCUS_PLAN_ORG_MISMATCH/
  )

  const { rows } = await db!.pool.query<{ plan_id: string }>(
    `insert into public.interview_focus_plans (organization_id, job_id, version_number) values ($1, $2, 98) returning plan_id`,
    [ORG_A, teacherJob]
  )
  await assert.rejects(
    db!.pool.query(
      `insert into public.interview_focus_areas (plan_id, organization_id, area_key, label, sort_order, coverage_weight) values ($1, $2, 'communication', 'Communication', 1, 100)`,
      [rows[0].plan_id, ORG_B]
    ),
    /FOCUS_AREA_ORG_MISMATCH/
  )
  await db!.pool.query(`delete from public.interview_focus_plans where plan_id = $1`, [rows[0].plan_id])
})

suite("saving edits creates a DRAFT and never changes the ACTIVE plan", async () => {
  const before = (await svc.getFocusPlans({ organizationId: ORG_A, jobId: teacherJob })).active!

  const draft = await svc.saveFocusDraft({
    organizationId: ORG_A,
    jobId: teacherJob,
    createdBy: USER,
    resumeEmphasis: "HEAVY",
    areas: [
      { areaKey: "role_knowledge", coverageWeight: 40 },
      { areaKey: "communication", coverageWeight: 30 },
      { label: "Classroom behaviour management", description: "Keeping a class focused", coverageWeight: 30 },
    ],
  })
  assert.equal(draft.status, "DRAFT")
  assert.equal(draft.versionNumber, 2)
  assert.equal(draft.origin, "CUSTOM")
  assert.equal(draft.resumeEmphasis, "HEAVY")
  assert.equal(draft.areas[2].areaKey, "custom_classroom_behaviour_management")
  assert.equal(draft.recommendation?.generated_at, before.recommendation?.generated_at, "recommendation carried forward")

  const again = await svc.saveFocusDraft({
    organizationId: ORG_A,
    jobId: teacherJob,
    resumeEmphasis: "LIGHT",
    areas: [{ areaKey: "role_knowledge", coverageWeight: 50 }, { areaKey: "communication", coverageWeight: 50 }],
  })
  assert.equal(again.planId, draft.planId, "the one draft is updated in place")
  assert.equal(again.areas.length, 2)

  const after = (await svc.getFocusPlans({ organizationId: ORG_A, jobId: teacherJob })).active!
  assert.deepEqual(after.areas, before.areas)
  assert.equal(after.planId, before.planId)
})

suite("invalid edits are rejected with every reason", async () => {
  await assert.rejects(
    svc.saveFocusDraft({
      organizationId: ORG_A,
      jobId: teacherJob,
      resumeEmphasis: "STANDARD",
      areas: [{ areaKey: "communication", coverageWeight: 45 }, { areaKey: "judgement", coverageWeight: 5 }],
    }),
    (error: { code: string; details?: { errors: string[] } }) => {
      assert.equal(error.code, "INVALID_FOCUS_PLAN")
      assert.ok(error.details!.errors.some((e) => /at least 10%/.test(e)))
      assert.ok(error.details!.errors.some((e) => /total exactly 100/.test(e)))
      return true
    }
  )

  const six = ["communication", "judgement", "ownership", "leadership", "adaptability", "collaboration"]
  await assert.rejects(
    svc.saveFocusDraft({
      organizationId: ORG_A,
      jobId: teacherJob,
      resumeEmphasis: "STANDARD",
      areas: six.map((areaKey, i) => ({ areaKey, coverageWeight: i < 4 ? 15 : 20 })),
    }),
    /at most 5 focus areas/
  )
})

suite("restoring VERIS Recommended reuses the cached recommendation and keeps resume emphasis", async () => {
  const active = (await svc.getFocusPlans({ organizationId: ORG_A, jobId: teacherJob })).active!
  const restored = await svc.restoreRecommendedFocusDraft({ organizationId: ORG_A, jobId: teacherJob })
  assert.equal(restored.status, "DRAFT")
  assert.equal(restored.origin, "VERIS_RECOMMENDED")
  assert.equal(restored.resumeEmphasis, "LIGHT", "recruiter's resume emphasis kept")
  assert.deepEqual(
    restored.areas.map((a) => [a.areaKey, a.coverageWeight]),
    active.areas.map((a) => [a.areaKey, a.coverageWeight])
  )
  assert.equal(restored.recommendation?.generated_at, active.recommendation?.generated_at, "no new recommendation computed")
})

suite("applying a draft supersedes the previous ACTIVE plan", async () => {
  await svc.saveFocusDraft({
    organizationId: ORG_A,
    jobId: teacherJob,
    resumeEmphasis: "OFF",
    areas: [{ areaKey: "role_knowledge", coverageWeight: 60 }, { areaKey: "judgement", coverageWeight: 40 }],
  })
  const applied = await svc.activateFocusDraft({ organizationId: ORG_A, jobId: teacherJob })
  assert.equal(applied.status, "ACTIVE")
  assert.equal(applied.resumeEmphasis, "OFF")

  const rows = await planRows(teacherJob)
  assert.deepEqual(rows.map((r) => r.status), ["SUPERSEDED", "ACTIVE"])
  assert.deepEqual((await svc.getFocusPlans({ organizationId: ORG_A, jobId: teacherJob })).draft, null)
  await assert.rejects(svc.activateFocusDraft({ organizationId: ORG_A, jobId: teacherJob }), { code: "NO_FOCUS_DRAFT" })
})

suite("ACTIVE and SUPERSEDED versions are immutable in the database", async () => {
  const { rows } = await db!.pool.query<{ plan_id: string; status: string }>(
    `select plan_id, status from public.interview_focus_plans where job_id = $1 order by version_number`,
    [teacherJob]
  )
  const superseded = rows.find((r) => r.status === "SUPERSEDED")!.plan_id
  const active = rows.find((r) => r.status === "ACTIVE")!.plan_id

  await assert.rejects(db!.pool.query(`update public.interview_focus_areas set coverage_weight = 50 where plan_id = $1`, [active]), /FOCUS_PLAN_IMMUTABLE/)
  await assert.rejects(
    db!.pool.query(`insert into public.interview_focus_areas (plan_id, organization_id, area_key, label, sort_order, coverage_weight) values ($1, $2, 'ownership', 'Ownership', 9, 10)`, [superseded, ORG_A]),
    /FOCUS_PLAN_IMMUTABLE/
  )
  await assert.rejects(db!.pool.query(`update public.interview_focus_plans set origin = 'CUSTOM' where plan_id = $1`, [superseded]), /FOCUS_PLAN_IMMUTABLE/)
  await assert.rejects(db!.pool.query(`update public.interview_focus_plans set status = 'DRAFT' where plan_id = $1`, [active]), /FOCUS_PLAN_IMMUTABLE/)
  await assert.rejects(db!.pool.query(`update public.interview_focus_plans set resume_emphasis = 'HEAVY' where plan_id = $1`, [active]), /FOCUS_PLAN_IMMUTABLE/)
  await assert.rejects(
    db!.pool.query(`update public.interview_focus_plans set status = 'ACTIVE' where plan_id = $1`, [superseded]),
    /FOCUS_PLAN_IMMUTABLE|ux_interview_focus_plans_one_active/
  )
})

suite("discarding a draft leaves the ACTIVE plan in place", async () => {
  await svc.saveFocusDraft({
    organizationId: ORG_A,
    jobId: teacherJob,
    resumeEmphasis: "STANDARD",
    areas: [{ areaKey: "communication", coverageWeight: 100 }],
  })
  assert.deepEqual(await svc.discardFocusDraft({ organizationId: ORG_A, jobId: teacherJob }), { discarded: true })
  const { active, draft } = await svc.getFocusPlans({ organizationId: ORG_A, jobId: teacherJob })
  assert.equal(draft, null)
  assert.equal(active?.status, "ACTIVE")
})

suite("longer interviews allow more focus areas; resume emphasis defaults from the job", async () => {
  const { plan } = await svc.ensureActiveFocusPlan({ organizationId: ORG_B, jobId: salesJob })
  assert.equal(plan.areas.length, 5)
  const six = await svc.saveFocusDraft({
    organizationId: ORG_B,
    jobId: salesJob,
    resumeEmphasis: "STANDARD",
    areas: ["communication", "judgement", "ownership", "leadership", "adaptability", "collaboration"].map((areaKey, i) => ({
      areaKey,
      coverageWeight: i < 4 ? 15 : 20,
    })),
  })
  assert.equal(six.areas.length, 6, "60-minute interview allows 6+")
})

suite("feature flag off: nothing is available and no plan is read", async () => {
  process.env.INTERVIEW_FOCUS_ENABLED = "false"
  try {
    assert.equal(await svc.isInterviewFocusAvailable(ORG_A), false)
    assert.equal(await svc.getActiveFocusPlan(ORG_A, teacherJob), null)
    await assert.rejects(svc.getFocusPlans({ organizationId: ORG_A, jobId: teacherJob }), { code: "INTERVIEW_FOCUS_UNAVAILABLE" })
  } finally {
    process.env.INTERVIEW_FOCUS_ENABLED = "true"
  }

  process.env.INTERVIEW_FOCUS_ORG_IDS = ORG_B
  try {
    assert.equal(await svc.isInterviewFocusAvailable(ORG_A), false, "allowlist excludes org A")
    assert.equal(await svc.isInterviewFocusAvailable(ORG_B), true)
  } finally {
    delete process.env.INTERVIEW_FOCUS_ORG_IDS
  }
})

suite("deleting a job still cascades through immutable plans", async () => {
  const job = await insertJob(ORG_A, "Operations Manager", 4, 45)
  await svc.ensureActiveFocusPlan({ organizationId: ORG_A, jobId: job })
  await db!.pool.query(`delete from public.job_positions where job_id = $1`, [job])
  assert.deepEqual(await planRows(job), [])
})

suite("direct deletes cannot change an ACTIVE/SUPERSEDED version; cascades and draft discards still work", async () => {
  const job = await insertJob(ORG_A, "Finance Manager", 3, 45)
  const { plan } = await svc.ensureActiveFocusPlan({ organizationId: ORG_A, jobId: job })
  await assert.rejects(db!.pool.query(`delete from public.interview_focus_areas where plan_id = $1`, [plan.planId]), /FOCUS_PLAN_IMMUTABLE/)
  await assert.rejects(db!.pool.query(`delete from public.interview_focus_plans where plan_id = $1`, [plan.planId]), /FOCUS_PLAN_IMMUTABLE/)

  await svc.saveFocusDraft({ organizationId: ORG_A, jobId: job, resumeEmphasis: "OFF", areas: [{ areaKey: "judgement", coverageWeight: 100 }] })
  assert.deepEqual(await svc.discardFocusDraft({ organizationId: ORG_A, jobId: job }), { discarded: true })

  await db!.pool.query(`delete from public.job_positions where job_id = $1`, [job])
  assert.deepEqual(await planRows(job), [])
  const { rows } = await db!.pool.query<{ n: number }>(`select count(*)::int as n from public.interview_focus_areas where plan_id = $1`, [plan.planId])
  assert.equal(rows[0].n, 0, "no orphaned areas")
})

suite("AI failure falls back to the deterministic recommendation", async () => {
  const originalFetch = globalThis.fetch
  process.env.OPENAI_API_KEY = "test-key"
  globalThis.fetch = (async () => new Response("upstream error", { status: 500 })) as typeof fetch
  try {
    const job = await insertJob(ORG_A, "Customer Success Manager", 3, 30)
    const { plan } = await svc.ensureActiveFocusPlan({ organizationId: ORG_A, jobId: job })
    assert.equal(plan.recommendation?.source, "fallback")
    assert.equal(plan.areas.reduce((s, a) => s + a.coverageWeight, 0), 100)
    assert.equal(plan.areas[0].areaKey, "customer_focus")
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENAI_API_KEY = ""
  }
})
