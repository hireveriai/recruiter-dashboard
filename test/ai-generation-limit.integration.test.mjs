/**
 * Race-condition and idempotency guarantees for the AI question-generation
 * limit (VERIS AI Interview + VERIS Assessment).
 *
 * These run against a real Postgres because the guarantee under test is a
 * database guarantee: the conditional UPDATE that reserveInterviewGenerationAttempt
 * / reserveAssessmentGenerationAttempt execute (see lib/server/services/
 * job-questionnaire.ts and lib/server/assessment/versions.ts) must never let
 * more than `generation_attempts < limit` concurrent requests succeed. Rather
 * than standing up the full job/assessment fixture graph, this exercises the
 * exact SQL shape those functions run against a minimal counter table -
 * mocking the atomicity itself would test nothing.
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
const GENERATION_LIMIT = 3

let pool

async function setup() {
  pool = new pg.Pool({ connectionString })
  await pool.query(`
    drop table if exists public.ai_gen_test_versions;
    create table public.ai_gen_test_versions (
      id uuid primary key default gen_random_uuid(),
      generation_attempts integer not null default 0
    );

    drop table if exists public.ai_gen_test_idempotency;
    create table public.ai_gen_test_idempotency (
      entity_id uuid not null,
      idempotency_key text not null,
      result jsonb not null,
      primary key (entity_id, idempotency_key)
    );
  `)
}

async function teardown() {
  await pool.query(`drop table if exists public.ai_gen_test_versions;`)
  await pool.query(`drop table if exists public.ai_gen_test_idempotency;`)
  await pool.end()
}

async function createVersion(attempts = 0) {
  const { rows } = await pool.query(
    `insert into public.ai_gen_test_versions (generation_attempts) values ($1) returning id::text`,
    [attempts]
  )
  return rows[0].id
}

/** Mirrors the exact conditional UPDATE the app runs to reserve an attempt. */
async function reserveAttempt(client, versionId) {
  const { rows } = await client.query(
    `update public.ai_gen_test_versions
     set generation_attempts = generation_attempts + 1
     where id = $1 and generation_attempts < $2
     returning generation_attempts`,
    [versionId, GENERATION_LIMIT]
  )
  return rows[0] ?? null
}

suite("sequential generations succeed exactly 3 times then block", async () => {
  await setup()
  try {
    const versionId = await createVersion()

    const first = await reserveAttempt(pool, versionId)
    const second = await reserveAttempt(pool, versionId)
    const third = await reserveAttempt(pool, versionId)
    const fourth = await reserveAttempt(pool, versionId)

    assert.equal(first.generation_attempts, 1)
    assert.equal(second.generation_attempts, 2)
    assert.equal(third.generation_attempts, 3)
    assert.equal(fourth, null, "a 4th attempt must be rejected, not silently allowed")

    const { rows } = await pool.query(
      `select generation_attempts from public.ai_gen_test_versions where id = $1`,
      [versionId]
    )
    assert.equal(rows[0].generation_attempts, 3, "the blocked attempt must not have incremented the counter")
  } finally {
    await teardown()
  }
})

suite("10 concurrent requests against a fresh draft authorize at most 3", async () => {
  await setup()
  try {
    const versionId = await createVersion()

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveAttempt(pool, versionId))
    )

    const authorized = results.filter((r) => r !== null)
    assert.equal(authorized.length, GENERATION_LIMIT, "exactly 3 of 10 concurrent requests may be authorized")

    const { rows } = await pool.query(
      `select generation_attempts from public.ai_gen_test_versions where id = $1`,
      [versionId]
    )
    assert.equal(rows[0].generation_attempts, GENERATION_LIMIT, "the counter itself must never exceed the limit")
  } finally {
    await teardown()
  }
})

suite("a compensating release refunds a failed generation without going negative", async () => {
  await setup()
  try {
    const versionId = await createVersion()
    await reserveAttempt(pool, versionId)
    await reserveAttempt(pool, versionId)

    // Simulate: reserve succeeded, then the AI provider call threw -
    // releaseInterviewGenerationAttempt / releaseAssessmentGenerationAttempt
    // decrement, floored at 0.
    await pool.query(
      `update public.ai_gen_test_versions
       set generation_attempts = greatest(0, generation_attempts - 1)
       where id = $1`,
      [versionId]
    )

    const { rows } = await pool.query(
      `select generation_attempts from public.ai_gen_test_versions where id = $1`,
      [versionId]
    )
    assert.equal(rows[0].generation_attempts, 1, "the failed attempt's reservation must be refunded")

    // The refunded slot must be usable again.
    const reclaimed = await reserveAttempt(pool, versionId)
    assert.equal(reclaimed.generation_attempts, 2)
  } finally {
    await teardown()
  }
})

suite("a new draft/version starts its own fresh allowance, independent of a sibling version", async () => {
  await setup()
  try {
    const exhaustedVersion = await createVersion(GENERATION_LIMIT)
    const blocked = await reserveAttempt(pool, exhaustedVersion)
    assert.equal(blocked, null)

    const freshVersion = await createVersion(0)
    const allowed = await reserveAttempt(pool, freshVersion)
    assert.equal(allowed.generation_attempts, 1, "a new draft is not a lifetime/global limit")
  } finally {
    await teardown()
  }
})

suite("a retried request with the same idempotency key never inserts twice", async () => {
  await setup()
  try {
    const versionId = await createVersion()
    const insert = () =>
      pool.query(
        `insert into public.ai_gen_test_idempotency (entity_id, idempotency_key, result)
         values ($1, $2, $3)
         on conflict (entity_id, idempotency_key) do nothing`,
        [versionId, "retry-key-1", JSON.stringify({ questionCount: 5 })]
      )

    await insert()
    await insert()
    await insert()

    const { rows } = await pool.query(
      `select count(*)::int as n from public.ai_gen_test_idempotency where entity_id = $1 and idempotency_key = $2`,
      [versionId, "retry-key-1"]
    )
    assert.equal(rows[0].n, 1, "repeated retries with the same key must collapse to a single stored result")
  } finally {
    await teardown()
  }
})
