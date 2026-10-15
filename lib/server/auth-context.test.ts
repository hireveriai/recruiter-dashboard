/**
 * getRecruiterRequestContext against an in-memory users table (installed
 * through the globalThis.prisma hook in lib/server/prisma.ts). No database or
 * network is used: fetch to the auth service always answers 401.
 */
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

const JWT_SECRET = "auth-context-test-secret"

process.env.JWT_SECRET = JWT_SECRET
delete process.env.RECRUITER_INVITE_TOKEN_SECRET
delete process.env.NEXTAUTH_SECRET
delete process.env.DEV_AUTH_BYPASS
delete process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS
globalThis.fetch = async () => new Response(null, { status: 401 })

type FakeUser = {
  user_id: string
  organization_id: string
  identity_id: string
  email: string
  role: string
  is_active: boolean
}

const ACTIVE: FakeUser = {
  user_id: "22222222-2222-4222-8222-222222222222",
  organization_id: "33333333-3333-4333-8333-333333333333",
  identity_id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.test",
  role: "ORG_OWNER",
  is_active: true,
}

const DISABLED: FakeUser = {
  user_id: "55555555-5555-4555-8555-555555555555",
  organization_id: "33333333-3333-4333-8333-333333333333",
  identity_id: "44444444-4444-4444-8444-444444444444",
  email: "removed.member@example.test",
  role: "RECRUITER",
  is_active: false,
}

const users = [ACTIVE, DISABLED]
const RECRUITER_ROLES = new Set(["RECRUITER", "ADMIN", "ORG_OWNER"])

type SqlLike = { sql?: string; values?: unknown[] }

function normalize(sql: SqlLike) {
  return (sql.sql ?? "").replace(/\s+/g, " ").trim()
}

function activeRecruiters() {
  return users.filter((user) => user.is_active && RECRUITER_ROLES.has(user.role))
}

function toRow(user: FakeUser) {
  return { user_id: user.user_id, organization_id: user.organization_id }
}

// Mirrors the statements auth-context issues, closely enough that the old
// behaviour (re-activating disabled users) would be observable here.
const fakePrisma = {
  async $queryRaw(sql: SqlLike) {
    const text = normalize(sql)
    const values = sql.values ?? []

    if (text.includes("u.identity_id::text =")) {
      return activeRecruiters().filter((user) => values.includes(user.identity_id)).map(toRow)
    }

    if (text.includes("where u.user_id::text =")) {
      return activeRecruiters()
        .filter((user) => user.user_id === values[0] && user.organization_id === values[1])
        .map(toRow)
    }

    if (text.includes("where lower(u.email) =")) {
      return activeRecruiters()
        .filter((user) => user.email === values[0] && (values.length < 2 || user.organization_id === values[1]))
        .map(toRow)
    }

    return []
  },

  async $executeRaw(sql: SqlLike) {
    const text = normalize(sql)
    const values = sql.values ?? []
    const [setClause, whereClause = ""] = text.split(" where ")

    if (text.startsWith("update public.users set role = case")) {
      const onlyActive = whereClause.includes("is_active = true")
      for (const user of users) {
        if (user.email === values[0] && user.organization_id === values[1] && (!onlyActive || user.is_active)) {
          if (setClause.includes("is_active = true")) user.is_active = true
        }
      }
    }

    if (text.startsWith("insert into public.users")) {
      const existing = users.find((user) => user.user_id === values[0])
      if (existing && text.split("on conflict")[1]?.includes("is_active = true")) {
        existing.is_active = true
      }
    }

    return 0
  },
}

;(globalThis as unknown as { prisma: unknown }).prisma = fakePrisma

const { getRecruiterRequestContext } = await import("@/lib/server/auth-context")

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function signedRecruiterJwt(user: FakeUser, extraClaims: Record<string, unknown> = {}) {
  const header = base64Url({ alg: "HS256", typ: "JWT" })
  const payload = base64Url({
    role: "recruiter",
    userId: user.user_id,
    orgId: user.organization_id,
    organizationId: user.organization_id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extraClaims,
  })
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url")
  return `${header}.${payload}.${signature}`
}

function requestWith(headers: Record<string, string>) {
  return new Request("https://recruiter.example.test/api/me", { headers })
}

async function assertUnauthorized(request: Request) {
  await assert.rejects(getRecruiterRequestContext(request), (error: { statusCode?: number }) => {
    assert.equal(error.statusCode, 401)
    return true
  })
}

test("a valid signed recruiter JWT for an active member authenticates", async () => {
  const context = await getRecruiterRequestContext(
    requestWith({ cookie: `authToken=${signedRecruiterJwt(ACTIVE)}` })
  )

  assert.equal(context.userId, ACTIVE.user_id)
  assert.equal(context.organizationId, ACTIVE.organization_id)
  assert.equal(context.sessionValidatedVia, "jwt")
})

test("an unsigned token is not trusted for its sub claim", async () => {
  const forged = `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({ sub: ACTIVE.identity_id })}.forged`

  await assertUnauthorized(requestWith({ authorization: `Bearer ${forged}` }))
  await assertUnauthorized(requestWith({ cookie: `authToken=${forged}` }))
})

test("a Supabase-style auth cookie is not trusted for its sub claim", async () => {
  const forged = `${base64Url({ alg: "HS256" })}.${base64Url({ sub: ACTIVE.identity_id })}.forged`
  const cookieValue = encodeURIComponent(JSON.stringify({ access_token: forged }))

  await assertUnauthorized(requestWith({ cookie: `sb-project-auth-token=${cookieValue}` }))
})

test("a signed recruiter JWT without exp is rejected", async () => {
  await assertUnauthorized(
    requestWith({ cookie: `authToken=${signedRecruiterJwt(ACTIVE, { exp: undefined })}` })
  )
})

test("an expired signed recruiter JWT is rejected", async () => {
  const expired = signedRecruiterJwt(ACTIVE, { exp: Math.floor(Date.now() / 1000) - 60 })
  await assertUnauthorized(requestWith({ cookie: `authToken=${expired}` }))
})

test("a disabled or removed member's signed JWT is rejected and does not re-activate them", async () => {
  await assertUnauthorized(requestWith({ cookie: `authToken=${signedRecruiterJwt(DISABLED)}` }))
  assert.equal(DISABLED.is_active, false)
})
