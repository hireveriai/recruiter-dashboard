/**
 * End-to-end tests for the free-entitlement request / review / grant flow.
 *
 * These run against a real Postgres because the guarantees under test are
 * database guarantees: unique grant keys, partial unique indexes, row locks and
 * conditional UPDATEs. Mocking them would test nothing.
 *
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=postgres --name hv-test postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres npm run test:db
 *
 * Without TEST_DATABASE_URL the whole suite skips rather than failing.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import pg from "pg"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "..")
const connectionString = process.env.TEST_DATABASE_URL

const suite = connectionString ? test : test.skip
const RECRUITER_INTERVIEWS = 10
const RECRUITER_SCREENINGS = 25

let pool

function sqlFile(relative) {
  return readFileSync(path.join(projectRoot, relative), "utf8")
}

async function applySchema() {
  const client = await pool.connect()

  try {
    await client.query("drop schema public cascade; create schema public;")
    await client.query(sqlFile("test/fixtures/entitlement-fixture-schema.sql"))
    await client.query(sqlFile("prisma/sql/prod/012_free_entitlement_requests.sql"))
    await client.query(sqlFile("prisma/sql/prod/013_free_entitlement_functions.sql"))
  } finally {
    client.release()
  }
}

async function resetData() {
  await pool.query(`
    truncate table
      public.trial_request_events,
      public.trial_grants,
      public.trial_requests,
      public.workspace_trial_credit_events,
      public.workspace_trial_credits,
      public.hireveri_user_subscriptions,
      public.candidate_identity_links,
      public.candidates,
      public.users,
      public.identity_users,
      public.organizations
    restart identity cascade
  `)
}

async function createOrganization(name = "Acme Corp") {
  const { rows } = await pool.query(
    `insert into public.organizations (organization_name) values ($1) returning organization_id::text`,
    [name]
  )
  return rows[0].organization_id
}

async function createRecruiter(organizationId, email, fullName = "Recruiter") {
  const { rows } = await pool.query(
    `insert into public.users (organization_id, full_name, email, role)
     values ($1::uuid, $2, $3, 'ORG_OWNER') returning user_id::text`,
    [organizationId, fullName, email]
  )
  return rows[0].user_id
}

async function createIdentity(email, { verified = true } = {}) {
  const { rows } = await pool.query(
    `insert into public.identity_users (email, primary_email, intent, is_verified)
     values ($1, $1, 'candidate_practice', $2) returning identity_id::text`,
    [email, verified]
  )
  return rows[0].identity_id
}

async function requestRecruiterTrial({
  organizationId,
  userId = null,
  email,
  emailVerified = true,
  companyName = "Acme Corp",
  website = null,
  ip = null,
  deviceHash = null,
}) {
  const { rows } = await pool.query(
    `select * from public.fn_request_recruiter_trial(
       $1::uuid, $2::uuid, $3::text, $4::boolean, $5::text, $6::text, $7::text, null::text, $8::text
     )`,
    [organizationId, userId, email, emailVerified, companyName, website, ip, deviceHash]
  )
  return rows[0]
}

async function requestCandidatePractice({
  identityId,
  email,
  emailVerified = true,
  ip = null,
  deviceHash = null,
}) {
  const { rows } = await pool.query(
    `select * from public.fn_request_candidate_practice(
       $1::uuid, $2::text, $3::boolean, $4::text, null::text, $5::text
     )`,
    [identityId, email, emailVerified, ip, deviceHash]
  )
  return rows[0]
}

async function getBalance(organizationId) {
  const { rows } = await pool.query(
    `select interview_credits_remaining, screening_credits_remaining, trial_status
     from public.workspace_trial_credits where organization_id = $1::uuid`,
    [organizationId]
  )
  return rows[0] ?? null
}

async function getRecruiterState(organizationId) {
  const { rows } = await pool.query(
    `select public.fn_get_recruiter_trial_state($1::uuid) as state`,
    [organizationId]
  )
  return rows[0].state
}

async function getPracticeState(identityId) {
  const { rows } = await pool.query(
    `select public.fn_get_candidate_practice_state($1::uuid) as state`,
    [identityId]
  )
  return rows[0].state
}

async function approve(requestId, actor = "admin@hireveri.com") {
  const { rows } = await pool.query(
    `select * from public.fn_approve_trial_request($1::uuid, $2::text, null::text)`,
    [requestId, actor]
  )
  return rows[0]
}

/** Mirrors the conditional UPDATE that deductTrialCredits runs in production. */
async function tryConsumeInterviewCredit(organizationId, amount = 1, client = pool) {
  const { rows } = await client.query(
    `update public.workspace_trial_credits
     set interview_credits_remaining = interview_credits_remaining - $2,
         updated_at = now()
     where organization_id = $1::uuid
       and trial_status = 'APPROVED'
       and interview_credits_remaining >= $2
     returning interview_credits_remaining`,
    [organizationId, amount]
  )
  return rows.length > 0
}

async function tryConsumeScreeningCredit(organizationId, amount = 1) {
  const { rows } = await pool.query(
    `update public.workspace_trial_credits
     set screening_credits_remaining = screening_credits_remaining - $2,
         updated_at = now()
     where organization_id = $1::uuid
       and trial_status = 'APPROVED'
       and screening_credits_remaining >= $2
     returning screening_credits_remaining`,
    [organizationId, amount]
  )
  return rows.length > 0
}

if (connectionString) {
  test.before(async () => {
    pool = new pg.Pool({ connectionString, max: 8 })
    await applySchema()
  })

  test.beforeEach(async () => {
    await resetData()
  })

  test.after(async () => {
    await pool?.end()
  })
} else {
  console.log(
    "\n[free-entitlements] TEST_DATABASE_URL is not set — database tests skipped.\n" +
      "  docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=postgres --name hv-test postgres:17\n" +
      "  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres npm run test:db\n"
  )
}

// ---------------------------------------------------------------------------
// Recruiter
// ---------------------------------------------------------------------------

suite("1. creating a recruiter organization grants no credits", async () => {
  const organizationId = await createOrganization()

  const balance = await getBalance(organizationId)
  // Migration 012 dropped the auto-seed trigger, so no balance row is created
  // at all. If one exists it must be zero and NOT_REQUESTED.
  if (balance) {
    assert.equal(balance.interview_credits_remaining, 0)
    assert.equal(balance.screening_credits_remaining, 0)
    assert.equal(balance.trial_status, "NOT_REQUESTED")
  }

  const state = await getRecruiterState(organizationId)
  assert.equal(state.status, "NOT_REQUESTED")
  assert.equal(state.granted, false)
  assert.equal(state.interviewCreditsRemaining, 0)
  assert.equal(state.screeningCreditsRemaining, 0)
})

suite("1b. the automatic seeding trigger no longer exists", async () => {
  const { rows } = await pool.query(
    `select count(*)::int as count from pg_trigger
     where tgname = 'organizations_seed_workspace_trial_credits'`
  )
  assert.equal(rows[0].count, 0)
})

suite("2 & 3. a recruiter can request a trial and an unverifiable one is held for review", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const userId = await createRecruiter(organizationId, "hiring@gmail.com")

  // Public mailbox + no website: nothing to verify a company against.
  const result = await requestRecruiterTrial({
    organizationId,
    userId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })

  assert.equal(result.status, "PENDING_REVIEW")
  assert.equal((await getBalance(organizationId)).trial_status, "PENDING_REVIEW")
  assert.equal((await getRecruiterState(organizationId)).granted, false)
})

suite("3b. a clearly verifiable company is approved automatically", async () => {
  const organizationId = await createOrganization("Acme Corp")
  const userId = await createRecruiter(organizationId, "priya@acme.com")

  const result = await requestRecruiterTrial({
    organizationId,
    userId,
    email: "priya@acme.com",
    companyName: "Acme Corp",
    website: "https://www.acme.com",
  })

  assert.equal(result.status, "APPROVED")
  assert.equal(result.auto_decision, true)
})

suite("4. approval grants exactly 10 AI interviews and 25 VERIS screenings", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const userId = await createRecruiter(organizationId, "hiring@gmail.com")
  const request = await requestRecruiterTrial({
    organizationId,
    userId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })

  const decision = await approve(request.request_id)
  assert.equal(decision.granted, true)

  const balance = await getBalance(organizationId)
  assert.equal(balance.interview_credits_remaining, RECRUITER_INTERVIEWS)
  assert.equal(balance.screening_credits_remaining, RECRUITER_SCREENINGS)
  assert.equal(balance.trial_status, "APPROVED")
})

suite("5. approving twice does not grant a second 10 / 25", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const request = await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })

  const first = await approve(request.request_id)
  const second = await approve(request.request_id)
  const third = await approve(request.request_id)

  assert.equal(first.granted, true)
  assert.equal(second.granted, false)
  assert.equal(third.granted, false)

  const balance = await getBalance(organizationId)
  assert.equal(balance.interview_credits_remaining, RECRUITER_INTERVIEWS)
  assert.equal(balance.screening_credits_remaining, RECRUITER_SCREENINGS)

  const { rows } = await pool.query(`select count(*)::int as count from public.trial_grants`)
  assert.equal(rows[0].count, 1)
})

suite("6. a rejected recruiter cannot consume trial resources", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const request = await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })

  await pool.query(`select * from public.fn_reject_trial_request($1::uuid, 'admin', 'unverifiable')`, [
    request.request_id,
  ])

  assert.equal((await getBalance(organizationId)).trial_status, "REJECTED")
  assert.equal(await tryConsumeInterviewCredit(organizationId), false)
  assert.equal(await tryConsumeScreeningCredit(organizationId), false)
})

suite("7. a pending recruiter cannot consume trial resources", async () => {
  const organizationId = await createOrganization("Nova Labs")
  await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })

  assert.equal(await tryConsumeInterviewCredit(organizationId), false)
  assert.equal(await tryConsumeScreeningCredit(organizationId), false)
})

suite("8. the same organization cannot receive a duplicate trial", async () => {
  const organizationId = await createOrganization("Acme Corp")
  const first = await requestRecruiterTrial({
    organizationId,
    email: "priya@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })
  assert.equal(first.status, "APPROVED")

  // A second submission returns the existing approved request unchanged.
  const second = await requestRecruiterTrial({
    organizationId,
    email: "priya@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })
  assert.equal(second.request_id, first.request_id)

  const balance = await getBalance(organizationId)
  assert.equal(balance.interview_credits_remaining, RECRUITER_INTERVIEWS)
  assert.equal(balance.screening_credits_remaining, RECRUITER_SCREENINGS)
})

suite("9. a second recruiter in the same organization gets no second trial", async () => {
  const organizationId = await createOrganization("Acme Corp")
  const recruiterA = await createRecruiter(organizationId, "priya@acme.com", "Priya")
  const recruiterB = await createRecruiter(organizationId, "sam@acme.com", "Sam")

  await requestRecruiterTrial({
    organizationId,
    userId: recruiterA,
    email: "priya@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })
  await requestRecruiterTrial({
    organizationId,
    userId: recruiterB,
    email: "sam@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })

  const balance = await getBalance(organizationId)
  assert.equal(balance.interview_credits_remaining, RECRUITER_INTERVIEWS)
  assert.equal(balance.screening_credits_remaining, RECRUITER_SCREENINGS)
})

suite("9b. a new organization on an already-granted domain is held for review", async () => {
  const first = await createOrganization("Acme Corp")
  await requestRecruiterTrial({
    organizationId: first,
    email: "priya@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })

  // Same company, brand new workspace: must not auto-approve a second trial.
  const second = await createOrganization("Acme Corp (2)")
  const result = await requestRecruiterTrial({
    organizationId: second,
    email: "sam@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })

  assert.equal(result.status, "PENDING_REVIEW")
  assert.ok(result.risk_reasons.includes("domain_already_received_trial"))
})

suite("10 & 22. the grant path cannot be driven directly without an approval", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const request = await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })

  await assert.rejects(
    () => pool.query(`select * from public.fn_apply_trial_grant($1::uuid)`, [request.request_id]),
    /TRIAL_REQUEST_NOT_APPROVED/
  )

  const balance = await getBalance(organizationId)
  assert.equal(balance.interview_credits_remaining, 0)
  assert.equal(balance.screening_credits_remaining, 0)
})

suite("11. existing paid subscription credits are untouched by the trial system", async () => {
  const organizationId = await createOrganization("Paying Corp")
  await pool.query(
    `insert into public.hireveri_user_subscriptions
       (id, "userId", "planId", "organizationId", "totalCredits", "screeningCredits", status, "activatedAt")
     values ('sub-1', 'user-1', 'starter-plan', $1::uuid, 50, 120, 'active', now())`,
    [organizationId]
  )

  await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Paying Corp",
  })

  const { rows } = await pool.query(
    `select "totalCredits", "screeningCredits", status from public.hireveri_user_subscriptions where id = 'sub-1'`
  )
  assert.equal(rows[0].totalCredits, 50)
  assert.equal(rows[0].screeningCredits, 120)
  assert.equal(rows[0].status, "active")
})

suite("12. the backfill grandfathers existing workspaces without changing balances", async () => {
  // A workspace that predates the request flow, with a partly spent balance.
  const organizationId = await createOrganization("Legacy Corp")
  await createRecruiter(organizationId, "owner@legacy.com", "Owner")
  await pool.query(
    `insert into public.workspace_trial_credits
       (organization_id, interview_credits_remaining, screening_credits_remaining, trial_status)
     values ($1::uuid, 5, 15, 'NOT_REQUESTED')`,
    [organizationId]
  )

  await pool.query(sqlFile("prisma/sql/prod/014_free_entitlement_backfill.sql"))

  const balance = await getBalance(organizationId)
  assert.equal(balance.interview_credits_remaining, 5, "balance must be preserved exactly")
  assert.equal(balance.screening_credits_remaining, 15, "balance must be preserved exactly")
  assert.equal(balance.trial_status, "APPROVED")

  // And it can keep spending, exactly as before the migration.
  assert.equal(await tryConsumeInterviewCredit(organizationId), true)
  assert.equal((await getBalance(organizationId)).interview_credits_remaining, 4)

  const state = await getRecruiterState(organizationId)
  assert.equal(state.granted, true)

  const { rows } = await pool.query(
    `select count(*)::int as count from public.trial_request_events where actor_type = 'MIGRATION'`
  )
  assert.ok(rows[0].count >= 1, "the backfill must be auditable")
})

// ---------------------------------------------------------------------------
// Candidate
// ---------------------------------------------------------------------------

suite("13. creating a practice account grants no free practice credit", async () => {
  const identityId = await createIdentity("aditi@gmail.com")

  const state = await getPracticeState(identityId)
  assert.equal(state.status, "NOT_REQUESTED")
  assert.equal(state.granted, false)
  assert.equal(state.freeCreditsRemaining, 0)

  const { rows } = await pool.query(`select count(*)::int as count from public.hireveri_user_subscriptions`)
  assert.equal(rows[0].count, 0)
})

suite("14 & 16. a candidate can request free practice and approval grants exactly one", async () => {
  const identityId = await createIdentity("aditi@gmail.com")

  const result = await requestCandidatePractice({ identityId, email: "aditi@gmail.com" })
  assert.equal(result.status, "APPROVED")

  const state = await getPracticeState(identityId)
  assert.equal(state.granted, true)
  assert.equal(state.freeCreditsRemaining, 1)

  const { rows } = await pool.query(
    `select "totalCredits", "planId" from public.hireveri_user_subscriptions where "userId" = $1`,
    [identityId]
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].totalCredits, 1)
  assert.equal(rows[0].planId, "practice-free-trial")
})

suite("15. an unverified candidate request is held for review", async () => {
  const identityId = await createIdentity("aditi@tempmail.com", { verified: false })

  const result = await requestCandidatePractice({
    identityId,
    email: "aditi@tempmail.com",
    emailVerified: false,
  })

  assert.equal(result.status, "PENDING_REVIEW")
  assert.equal((await getPracticeState(identityId)).freeCreditsRemaining, 0)
})

suite("17. approving a candidate request twice does not grant two practice interviews", async () => {
  const identityId = await createIdentity("aditi@tempmail.com", { verified: false })
  const request = await requestCandidatePractice({
    identityId,
    email: "aditi@tempmail.com",
    emailVerified: false,
  })

  const first = await approve(request.request_id)
  const second = await approve(request.request_id)

  assert.equal(first.granted, true)
  assert.equal(second.granted, false)

  const { rows } = await pool.query(
    `select "totalCredits" from public.hireveri_user_subscriptions where "userId" = $1`,
    [identityId]
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].totalCredits, 1)
})

suite("18. a pending candidate has no credit to start an interview with", async () => {
  const identityId = await createIdentity("aditi@tempmail.com", { verified: false })
  await requestCandidatePractice({ identityId, email: "aditi@tempmail.com", emailVerified: false })

  const state = await getPracticeState(identityId)
  assert.equal(state.status, "PENDING_REVIEW")
  assert.equal(state.freeCreditsRemaining, 0)
})

suite("19. a new email alias for the same person does not silently grant a second practice", async () => {
  const firstIdentity = await createIdentity("aditi.sharma@gmail.com")
  await requestCandidatePractice({
    identityId: firstIdentity,
    email: "aditi.sharma@gmail.com",
    ip: "203.0.113.10",
    deviceHash: "device-a",
  })

  // Gmail dots and plus tags are the same inbox.
  const secondIdentity = await createIdentity("aditisharma+practice@gmail.com")
  const result = await requestCandidatePractice({
    identityId: secondIdentity,
    email: "aditisharma+practice@gmail.com",
    ip: "203.0.113.11",
    deviceHash: "device-b",
  })

  assert.equal(result.status, "PENDING_REVIEW")
  assert.ok(result.risk_reasons.includes("normalized_email_already_used_free_practice"))
  assert.equal((await getPracticeState(secondIdentity)).freeCreditsRemaining, 0)
})

suite("19b. a genuinely different address on the same device is held for review, not granted", async () => {
  const firstIdentity = await createIdentity("one@gmail.com")
  await requestCandidatePractice({
    identityId: firstIdentity,
    email: "one@gmail.com",
    ip: "203.0.113.10",
    deviceHash: "shared-device",
  })

  const secondIdentity = await createIdentity("completely.other.person@gmail.com")
  const result = await requestCandidatePractice({
    identityId: secondIdentity,
    email: "completely.other.person@gmail.com",
    ip: "203.0.113.10",
    deviceHash: "shared-device",
  })

  // Held for a human to look at — deliberately NOT a permanent block.
  assert.equal(result.status, "PENDING_REVIEW")
  assert.ok(result.risk_reasons.includes("device_already_used_free_practice"))

  // And a reviewer can still approve it, because a shared device is a normal
  // thing (family, library, office).
  const decision = await approve(result.request_id)
  assert.equal(decision.granted, true)
  assert.equal((await getPracticeState(secondIdentity)).freeCreditsRemaining, 1)
})

suite("20. a candidate who already used their free practice gets no automatic second one", async () => {
  const identityId = await createIdentity("aditi@gmail.com")
  await requestCandidatePractice({ identityId, email: "aditi@gmail.com" })

  // Spend it.
  await pool.query(
    `update public.hireveri_user_subscriptions
     set "totalCredits" = 0, "usedCredits" = 1
     where id = 'free-practice-' || $1::text`,
    [identityId]
  )

  const state = await getPracticeState(identityId)
  assert.equal(state.consumed, true)
  assert.equal(state.freeCreditsRemaining, 0)

  // Requesting again is a no-op that returns the original approval; no second
  // credit appears.
  await requestCandidatePractice({ identityId, email: "aditi@gmail.com" })

  const { rows } = await pool.query(
    `select "totalCredits", "usedCredits" from public.hireveri_user_subscriptions where "userId" = $1`,
    [identityId]
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].totalCredits, 0)
})

suite("21. a former practice candidate can still become a recruiter", async () => {
  const identityId = await createIdentity("aditi@acme.com")
  await requestCandidatePractice({ identityId, email: "aditi@acme.com" })
  assert.equal((await getPracticeState(identityId)).freeCreditsRemaining, 1)

  // Later, the same person joins a company and requests a recruiter trial.
  const organizationId = await createOrganization("Acme Corp")
  const result = await requestRecruiterTrial({
    organizationId,
    email: "aditi@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })

  assert.equal(result.status, "APPROVED", "prior candidate usage must not block recruiter access")

  const balance = await getBalance(organizationId)
  assert.equal(balance.interview_credits_remaining, RECRUITER_INTERVIEWS)
  assert.equal(balance.screening_credits_remaining, RECRUITER_SCREENINGS)

  // The candidate entitlement is untouched and separate.
  assert.equal((await getPracticeState(identityId)).freeCreditsRemaining, 1)
})

suite("21b. a recruiter trial does not grant candidate practice credit", async () => {
  const organizationId = await createOrganization("Acme Corp")
  await requestRecruiterTrial({
    organizationId,
    email: "priya@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })

  const { rows } = await pool.query(
    `select count(*)::int as count from public.hireveri_user_subscriptions where "planId" = 'practice-free-trial'`
  )
  assert.equal(rows[0].count, 0)
})

// ---------------------------------------------------------------------------
// Security / concurrency
// ---------------------------------------------------------------------------

suite("23. concurrent approvals of the same request grant credits exactly once", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const request = await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => approve(request.request_id))
  )

  const grantedCount = results.filter(
    (result) => result.status === "fulfilled" && result.value?.granted === true
  ).length

  assert.equal(grantedCount, 1, "exactly one concurrent approval may issue credits")

  const balance = await getBalance(organizationId)
  assert.equal(balance.interview_credits_remaining, RECRUITER_INTERVIEWS)
  assert.equal(balance.screening_credits_remaining, RECRUITER_SCREENINGS)

  const { rows } = await pool.query(`select count(*)::int as count from public.trial_grants`)
  assert.equal(rows[0].count, 1)
})

suite("23b. concurrent trial requests for one organization create one request", async () => {
  const organizationId = await createOrganization("Nova Labs")

  await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      requestRecruiterTrial({ organizationId, email: "hiring@gmail.com", companyName: "Nova Labs" })
    )
  )

  const { rows } = await pool.query(
    `select count(*)::int as count from public.trial_requests where organization_id = $1::uuid`,
    [organizationId]
  )
  assert.equal(rows[0].count, 1)
})

suite("24. concurrent interview starts cannot spend more credits than exist", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const request = await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })
  await approve(request.request_id)

  // 25 racing consumers against a balance of 10.
  const results = await Promise.all(
    Array.from({ length: 25 }, () => tryConsumeInterviewCredit(organizationId))
  )

  assert.equal(results.filter(Boolean).length, RECRUITER_INTERVIEWS)
  assert.equal((await getBalance(organizationId)).interview_credits_remaining, 0)
})

suite("24b. concurrent practice starts cannot spend the single free credit twice", async () => {
  const identityId = await createIdentity("aditi@gmail.com")
  await requestCandidatePractice({ identityId, email: "aditi@gmail.com" })

  const consume = async () => {
    const { rows } = await pool.query(
      `update public.hireveri_user_subscriptions
       set "totalCredits" = "totalCredits" - 1, "usedCredits" = coalesce("usedCredits", 0) + 1
       where id = 'free-practice-' || $1::text and "totalCredits" >= 1
       returning "totalCredits"`,
      [identityId]
    )
    return rows.length > 0
  }

  const results = await Promise.all(Array.from({ length: 8 }, consume))
  assert.equal(results.filter(Boolean).length, 1)
})

suite("25. trial requests are rate limited per source IP", async () => {
  const ip = "198.51.100.7"

  // Fill the 24h window from a single address.
  for (let index = 0; index < 20; index += 1) {
    const organizationId = await createOrganization(`Burst ${index}`)
    await requestRecruiterTrial({
      organizationId,
      email: `user${index}@gmail.com`,
      companyName: `Burst ${index}`,
      ip,
    })
  }

  const organizationId = await createOrganization("Burst final")
  await assert.rejects(
    () =>
      requestRecruiterTrial({
        organizationId,
        email: "final@gmail.com",
        companyName: "Burst final",
        ip,
      }),
    /TRIAL_REQUEST_RATE_LIMITED/
  )

  // A different address is unaffected.
  const cleanOrg = await createOrganization("Clean Corp")
  const result = await requestRecruiterTrial({
    organizationId: cleanOrg,
    email: "ops@cleancorp.com",
    companyName: "Clean Corp",
    website: "cleancorp.com",
    ip: "198.51.100.8",
  })
  assert.ok(["APPROVED", "PENDING_REVIEW"].includes(result.status))
})

suite("25b. a burst from one IP pushes otherwise-clean requests into review", async () => {
  const ip = "198.51.100.20"

  for (let index = 0; index < 2; index += 1) {
    const organizationId = await createOrganization(`Soft ${index}`)
    await requestRecruiterTrial({
      organizationId,
      email: `ops@softcorp${index}.com`,
      companyName: `Soft ${index}`,
      website: `softcorp${index}.com`,
      ip,
    })
  }

  const organizationId = await createOrganization("Soft 2")
  const result = await requestRecruiterTrial({
    organizationId,
    email: "ops@softcorp2.com",
    companyName: "Soft 2",
    website: "softcorp2.com",
    ip,
  })

  assert.equal(result.status, "PENDING_REVIEW")
  assert.ok(result.risk_reasons.includes("ip_request_burst"))
})

suite("26. grant issuance is idempotent and fully audited", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const request = await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })
  await approve(request.request_id)

  const { rows: grants } = await pool.query(
    `select grant_key, ai_interview_credits, veris_screening_credits from public.trial_grants`
  )
  assert.equal(grants.length, 1)
  assert.equal(grants[0].grant_key, `RECRUITER_TRIAL:org:${organizationId}`)
  assert.equal(grants[0].ai_interview_credits, RECRUITER_INTERVIEWS)
  assert.equal(grants[0].veris_screening_credits, RECRUITER_SCREENINGS)

  // The grant key is a hard uniqueness guarantee, not just application logic.
  await assert.rejects(
    () =>
      pool.query(
        `insert into public.trial_grants (grant_key, request_id, request_type, organization_id)
         values ($1, $2::uuid, 'RECRUITER_TRIAL', $3::uuid)`,
        [`RECRUITER_TRIAL:org:${organizationId}`, request.request_id, organizationId]
      ),
    /duplicate key value/
  )

  const { rows: events } = await pool.query(
    `select to_status, actor_type from public.trial_request_events
     where request_id = $1::uuid order by created_at`,
    [request.request_id]
  )
  assert.ok(events.some((event) => event.to_status === "PENDING_REVIEW"))
  assert.ok(events.some((event) => event.actor_type === "ADMIN" && event.to_status === "APPROVED"))

  const { rows: creditEvents } = await pool.query(
    `select kind, amount from public.workspace_trial_credit_events
     where organization_id = $1::uuid and source = 'free_trial_grant' order by kind`,
    [organizationId]
  )
  assert.deepEqual(
    creditEvents.map((event) => [event.kind, event.amount]),
    [
      ["INTERVIEW", RECRUITER_INTERVIEWS],
      ["SCREENING", RECRUITER_SCREENINGS],
    ]
  )
})

suite("26b. a rejected request cannot be re-submitted during the cooldown", async () => {
  const organizationId = await createOrganization("Nova Labs")
  const request = await requestRecruiterTrial({
    organizationId,
    email: "hiring@gmail.com",
    companyName: "Nova Labs",
  })
  await pool.query(`select * from public.fn_reject_trial_request($1::uuid, 'admin', null)`, [
    request.request_id,
  ])

  await assert.rejects(
    () =>
      requestRecruiterTrial({
        organizationId,
        email: "hiring@gmail.com",
        companyName: "Nova Labs",
      }),
    /TRIAL_REAPPLY_TOO_SOON/
  )
})

suite("26c. an already-granted trial cannot be rejected away behind the scenes", async () => {
  const organizationId = await createOrganization("Acme Corp")
  const request = await requestRecruiterTrial({
    organizationId,
    email: "priya@acme.com",
    companyName: "Acme Corp",
    website: "acme.com",
  })

  await assert.rejects(
    () => pool.query(`select * from public.fn_reject_trial_request($1::uuid, 'admin', null)`, [request.request_id]),
    /TRIAL_REQUEST_ALREADY_APPROVED/
  )
})
