/**
 * requireAiRouteAccess against in-memory recruiter and attempt rows (installed
 * through the globalThis.prisma hook in lib/server/prisma.ts). No database or
 * network is used: fetch to the auth service always answers 401.
 */
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

const JWT_SECRET = "route-access-test-secret"

process.env.JWT_SECRET = JWT_SECRET
delete process.env.RECRUITER_INVITE_TOKEN_SECRET
delete process.env.NEXTAUTH_SECRET
delete process.env.DEV_AUTH_BYPASS
delete process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS
globalThis.fetch = async () => new Response(null, { status: 401 })

const RECRUITER = {
  user_id: "22222222-2222-4222-8222-222222222222",
  organization_id: "33333333-3333-4333-8333-333333333333",
  email: "recruiter@example.test",
}

const OWN_ATTEMPT = {
  attempt_id: "77777777-7777-4777-8777-777777777777",
  interview_id: "88888888-8888-4888-8888-888888888888",
  organization_id: RECRUITER.organization_id,
}

const OTHER_ORG_ATTEMPT = {
  attempt_id: "99999999-9999-4999-8999-999999999999",
  interview_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
}

type SqlLike = { sql?: string; values?: unknown[] }

const fakePrisma = {
  async $queryRaw(sql: SqlLike) {
    const text = (sql.sql ?? "").replace(/\s+/g, " ")
    const values = sql.values ?? []

    if (text.includes("where u.user_id::text =")) {
      return values[0] === RECRUITER.user_id && values[1] === RECRUITER.organization_id
        ? [{ user_id: RECRUITER.user_id, organization_id: RECRUITER.organization_id }]
        : []
    }

    if (text.includes("from public.interview_attempts ia")) {
      return [OWN_ATTEMPT, OTHER_ORG_ATTEMPT]
        .filter((attempt) => attempt.attempt_id === values[0] && attempt.organization_id === values[1])
        .map((attempt) => ({ interview_id: attempt.interview_id }))
    }

    return []
  },
  async $executeRaw() {
    return 0
  },
}

;(globalThis as unknown as { prisma: unknown }).prisma = fakePrisma

const { requireAiRouteAccess } = await import("@/lib/server/ai/route-access")

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function signedRecruiterRequest() {
  const header = base64Url({ alg: "HS256", typ: "JWT" })
  const payload = base64Url({
    role: "recruiter",
    userId: RECRUITER.user_id,
    orgId: RECRUITER.organization_id,
    email: RECRUITER.email,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url")
  return new Request("https://recruiter.example.test/api/ai/evaluate", {
    method: "POST",
    headers: { cookie: `authToken=${header}.${payload}.${signature}` },
  })
}

function assertStatus(status: number, code?: string) {
  return (error: { statusCode?: number; code?: string }) => {
    assert.equal(error.statusCode, status)
    if (code) assert.equal(error.code, code)
    return true
  }
}

test("rejects a request without a recruiter session", async () => {
  const request = new Request("https://recruiter.example.test/api/ai/interview/followup", { method: "POST" })
  await assert.rejects(requireAiRouteAccess(request), assertStatus(401))
})

test("allows a recruiter when no attempt is named", async () => {
  const access = await requireAiRouteAccess(signedRecruiterRequest())

  assert.equal(access.auth.organizationId, RECRUITER.organization_id)
  assert.equal(access.attempt, null)
})

test("returns the verified interview for an attempt in the recruiter's organization", async () => {
  const access = await requireAiRouteAccess(signedRecruiterRequest(), OWN_ATTEMPT.attempt_id)

  assert.deepEqual(access.attempt, {
    attemptId: OWN_ATTEMPT.attempt_id,
    interviewId: OWN_ATTEMPT.interview_id,
  })
})

test("hides an attempt that belongs to another organization", async () => {
  await assert.rejects(
    requireAiRouteAccess(signedRecruiterRequest(), OTHER_ORG_ATTEMPT.attempt_id),
    assertStatus(404, "ATTEMPT_NOT_FOUND")
  )
})

test("rejects a malformed attempt id before querying", async () => {
  await assert.rejects(
    requireAiRouteAccess(signedRecruiterRequest(), "not-a-uuid"),
    assertStatus(400, "INVALID_ATTEMPT_ID")
  )
})
