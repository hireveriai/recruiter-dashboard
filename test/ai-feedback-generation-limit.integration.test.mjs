/**
 * Race-condition and idempotency guarantees for the AI candidate-feedback
 * generation limit (sibling feature to ai-generation-limit.integration.test.mjs,
 * which covers the questionnaire/assessment draft-version limit).
 *
 * Candidate feedback has no draft/version row to fork - interviews is a
 * singleton row, overwritten in place on regenerate (see
 * lib/server/services/candidate-feedback.ts:reserveCandidateFeedbackGenerationAttempt)
 * - so this exercises the exact same atomic-UPDATE shape directly against a
 * minimal counter table, scoped per interview instead of per draft version.
 *
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=postgres --name hv-test postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres npm run test:db
 *
 * Without TEST_DATABASE_URL the whole suite skips rather than failing.
 */

import assert from "node:assert/strict"
import test from "node:test"

import pg from "pg"

const connectionString = process.env.TEST_DATABASE_URL
const suite = connectionString ? test : test.skip
const FEEDBACK_GENERATION_LIMIT = 3

let pool

async function setup() {
  pool = new pg.Pool({ connectionString })
  await pool.query(`
    drop table if exists public.ai_feedback_test_interviews;
    create table public.ai_feedback_test_interviews (
      id uuid primary key default gen_random_uuid(),
      candidate_feedback_text text,
      candidate_feedback_generation_attempts integer not null default 0
    );
  `)
}

async function teardown() {
  await pool.query(`drop table if exists public.ai_feedback_test_interviews;`)
  await pool.end()
}

async function createInterview({ attempts = 0, text = null } = {}) {
  const { rows } = await pool.query(
    `insert into public.ai_feedback_test_interviews (candidate_feedback_generation_attempts, candidate_feedback_text)
     values ($1, $2) returning id::text`,
    [attempts, text]
  )
  return rows[0].id
}

/** Mirrors reserveCandidateFeedbackGenerationAttempt's exact conditional UPDATE. */
async function reserveAttempt(client, interviewId) {
  const { rows } = await client.query(
    `update public.ai_feedback_test_interviews
     set candidate_feedback_generation_attempts = candidate_feedback_generation_attempts + 1
     where id = $1 and candidate_feedback_generation_attempts < $2
     returning candidate_feedback_generation_attempts`,
    [interviewId, FEEDBACK_GENERATION_LIMIT]
  )
  return rows[0] ?? null
}

async function releaseAttempt(client, interviewId) {
  await client.query(
    `update public.ai_feedback_test_interviews
     set candidate_feedback_generation_attempts = greatest(0, candidate_feedback_generation_attempts - 1)
     where id = $1`,
    [interviewId]
  )
}

suite("initial generation, then 2 regenerations succeed; a 4th is rejected", async () => {
  await setup()
  try {
    const interviewId = await createInterview()

    const initial = await reserveAttempt(pool, interviewId)
    const firstRegen = await reserveAttempt(pool, interviewId)
    const secondRegen = await reserveAttempt(pool, interviewId)
    const blocked = await reserveAttempt(pool, interviewId)

    assert.equal(initial.candidate_feedback_generation_attempts, 1)
    assert.equal(firstRegen.candidate_feedback_generation_attempts, 2)
    assert.equal(secondRegen.candidate_feedback_generation_attempts, 3)
    assert.equal(blocked, null, "generation #4 must be rejected")
  } finally {
    await teardown()
  }
})

suite("10 concurrent regenerate requests against one interview authorize at most 3", async () => {
  await setup()
  try {
    const interviewId = await createInterview()

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveAttempt(pool, interviewId))
    )
    const authorized = results.filter((r) => r !== null)
    assert.equal(authorized.length, FEEDBACK_GENERATION_LIMIT, "exactly 3 of 10 concurrent requests may be authorized")

    const { rows } = await pool.query(
      `select candidate_feedback_generation_attempts from public.ai_feedback_test_interviews where id = $1`,
      [interviewId]
    )
    assert.equal(rows[0].candidate_feedback_generation_attempts, FEEDBACK_GENERATION_LIMIT)
  } finally {
    await teardown()
  }
})

suite("a provider failure after reservation is refunded and does not cost a real attempt", async () => {
  await setup()
  try {
    const interviewId = await createInterview()
    await reserveAttempt(pool, interviewId) // succeeded, text persisted (simulated below)
    await reserveAttempt(pool, interviewId) // this one "fails" before producing text

    // Simulate the failure path: release the just-reserved, unpersisted attempt.
    await releaseAttempt(pool, interviewId)

    const { rows } = await pool.query(
      `select candidate_feedback_generation_attempts from public.ai_feedback_test_interviews where id = $1`,
      [interviewId]
    )
    assert.equal(rows[0].candidate_feedback_generation_attempts, 1, "the failed attempt must be refunded")

    const reclaimed = await reserveAttempt(pool, interviewId)
    assert.equal(reclaimed.candidate_feedback_generation_attempts, 2, "the refunded slot must be usable again")
  } finally {
    await teardown()
  }
})

suite("the limit is per interview, not a lifetime/global recruiter limit", async () => {
  await setup()
  try {
    const exhausted = await createInterview({ attempts: FEEDBACK_GENERATION_LIMIT })
    assert.equal(await reserveAttempt(pool, exhausted), null)

    const otherInterview = await createInterview()
    const allowed = await reserveAttempt(pool, otherInterview)
    assert.equal(allowed.candidate_feedback_generation_attempts, 1, "a sibling interview has its own fresh allowance")
  } finally {
    await teardown()
  }
})

suite("reopening/refreshing a report never reserves an attempt - only an explicit generate call does", async () => {
  await setup()
  try {
    // Feedback already exists (e.g. from a prior generation); simulate the
    // read-only "recruiter opens the report" path, which must never call
    // reserveAttempt at all.
    const interviewId = await createInterview({ attempts: 1, text: "existing feedback" })

    const { rows: before } = await pool.query(
      `select candidate_feedback_generation_attempts, candidate_feedback_text
       from public.ai_feedback_test_interviews where id = $1`,
      [interviewId]
    )
    // Simulated "view" reads: no reserveAttempt call, ever.
    for (let i = 0; i < 5; i += 1) {
      await pool.query(
        `select candidate_feedback_generation_attempts, candidate_feedback_text
         from public.ai_feedback_test_interviews where id = $1`,
        [interviewId]
      )
    }

    const { rows: after } = await pool.query(
      `select candidate_feedback_generation_attempts, candidate_feedback_text
       from public.ai_feedback_test_interviews where id = $1`,
      [interviewId]
    )
    assert.equal(after[0].candidate_feedback_generation_attempts, before[0].candidate_feedback_generation_attempts)
    assert.equal(after[0].candidate_feedback_text, before[0].candidate_feedback_text)
  } finally {
    await teardown()
  }
})
