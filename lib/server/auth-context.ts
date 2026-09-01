import { Prisma } from "@prisma/client"
import { createHmac, timingSafeEqual } from "crypto"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

export type RecruiterRequestContext = {
  userId: string
  organizationId: string
  sessionCookiePresent: boolean
  sessionCookieMatched: boolean
  sessionValidatedVia: "auth_session" | "identity_cookie" | "jwt"
}

type AuthSessionRow = {
  session_id: string
  identity_id: string
  is_active: boolean | null
  idle_expired: boolean
}

type AuthIdentityRow = {
  identity_id: string
}

type AuthUserRow = {
  email: string | null
}

type RecruiterLookupRow = {
  user_id: string
  organization_id: string
}

type AuthServiceRecruiterSession = {
  userId?: string
  organizationId?: string
  identityId?: string
  email?: string
}

type AuthServiceRecruiterToken = {
  userId?: string
  organizationId?: string
  email?: string | null
}

type JwtClaims = {
  sub?: string
  userId?: string
  orgId?: string
  organizationId?: string
  role?: string
  email?: string
}

type RecruiterJwtLookup = RecruiterLookupRow & {
  email?: string
}

type CookieEntry = {
  key: string
  value: string
}

declare global {
  var __verisnovaRecruiterAuthServiceCache:
    | Map<string, { expiresAt: number; recruiter: RecruiterLookupRow }>
    | undefined
  var __verisnovaRecruiterAuthServiceInFlight:
    | Map<string, Promise<RecruiterLookupRow | null>>
    | undefined
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AUTH_APP_URL =
  process.env.AUTH_APP_URL ||
  process.env.NEXT_PUBLIC_AUTH_APP_URL ||
  process.env.NEXT_PUBLIC_RECRUITER_LOGIN_URL ||
  process.env.NEXT_PUBLIC_LOGIN_URL ||
  "https://auth.verisnova.com"
const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== "production" &&
  (process.env.DEV_AUTH_BYPASS === "true" ||
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true")
const AUTH_SERVICE_CACHE_TTL_MS = 60_000
const AUTH_SERVICE_CACHE_MAX_ENTRIES = 500
/**
 * Inactivity ceiling for a recruiter session, independent of auth_sessions
 * .expires_at (30 days). Every validated request stamps last_seen_at; a session
 * left untouched for this long is retired and the recruiter goes back to the
 * recruiter login screen. Keep in sync with auth/lib/session/idle-timeout.ts.
 */
const IDLE_SESSION_TIMEOUT_HOURS = 12

function getAuthServiceCache() {
  if (!global.__verisnovaRecruiterAuthServiceCache) {
    global.__verisnovaRecruiterAuthServiceCache = new Map()
  }

  return global.__verisnovaRecruiterAuthServiceCache
}

function getAuthServiceInFlightMap() {
  if (!global.__verisnovaRecruiterAuthServiceInFlight) {
    global.__verisnovaRecruiterAuthServiceInFlight = new Map()
  }

  return global.__verisnovaRecruiterAuthServiceInFlight
}

function getCachedAuthServiceRecruiter(sessionId: string) {
  const cache = getAuthServiceCache()
  const cached = cache.get(sessionId)

  if (!cached) {
    return null
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(sessionId)
    return null
  }

  return cached.recruiter
}

function setCachedAuthServiceRecruiter(sessionId: string, recruiter: RecruiterLookupRow) {
  const cache = getAuthServiceCache()

  if (cache.size >= AUTH_SERVICE_CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value
    if (firstKey) {
      cache.delete(firstKey)
    }
  }

  cache.set(sessionId, {
    expiresAt: Date.now() + AUTH_SERVICE_CACHE_TTL_MS,
    recruiter,
  })
}

function clearCachedAuthServiceRecruiter(sessionId: string) {
  getAuthServiceCache().delete(sessionId)
}

function parseCookieEntries(cookieHeader: string | null): CookieEntry[] {
  if (!cookieHeader) {
    return []
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<CookieEntry[]>((acc, part) => {
      const separatorIndex = part.indexOf("=")

      if (separatorIndex === -1) {
        return acc
      }

      const key = part.slice(0, separatorIndex).trim()
      const value = part.slice(separatorIndex + 1).trim()
      acc.push({ key, value })
      return acc
    }, [])
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  return parseCookieEntries(cookieHeader).reduce<Record<string, string>>((acc, entry) => {
    acc[entry.key] = entry.value
    return acc
  }, {})
}

function uniqueNormalizedValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const candidate = normalizeCookieValue(value)

    if (!candidate || seen.has(candidate)) {
      continue
    }

    seen.add(candidate)
    normalized.push(candidate)
  }

  return normalized
}

function getCookieValues(cookieHeader: string | null, name: string) {
  return parseCookieEntries(cookieHeader)
    .filter((entry) => entry.key === name)
    .map((entry) => entry.value)
}

function normalizeCookieValue(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function throwRecruiterLookupFailed(context: string, error: unknown): never {
  console.error(context, error)
  throw new ApiError(500, "RECRUITER_LOOKUP_FAILED", "Could not validate recruiter access. Please try again.")
}

function workspaceNameFromEmail(email?: string | null) {
  const localPart = email?.split("@")[0]?.trim()
  return localPart ? `${localPart}'s Workspace` : "Recruiter Workspace"
}

async function ensureRecruiterOrganization(input: {
  organizationId: string
  email?: string | null
}) {
  if (!UUID_REGEX.test(input.organizationId)) {
    return false
  }

  try {
    await prisma.$executeRaw(Prisma.sql`
      insert into public.organizations (
        organization_id,
        organization_name,
        is_active,
        created_at
      )
      values (
        ${input.organizationId}::uuid,
        ${workspaceNameFromEmail(input.email)},
        true,
        now()
      )
      on conflict (organization_id) do nothing
    `)

    return true
  } catch (error) {
    console.warn("Recruiter organization auto-heal failed", error)
    return false
  }
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
    return Buffer.from(normalized, "base64").toString("utf8")
  } catch {
    return null
  }
}

function parseJwtClaims(token: string | null | undefined): JwtClaims | null {
  if (!token) {
    return null
  }

  const parts = token.split(".")
  if (parts.length < 2) {
    return null
  }

  const payload = decodeBase64Url(parts[1])
  if (!payload) {
    return null
  }

  try {
    return JSON.parse(payload) as JwtClaims
  } catch {
    return null
  }
}

function decodeJwtSub(token: string | null | undefined): string | null {
  const sub = parseJwtClaims(token)?.sub?.trim()
  return sub && UUID_REGEX.test(sub) ? sub : null
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function verifyHs256Jwt(token: string) {
  const secret = process.env.JWT_SECRET || process.env.RECRUITER_INVITE_TOKEN_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    return false
  }

  const parts = token.split(".")
  if (parts.length !== 3) {
    return false
  }

  const expected = base64UrlEncode(createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest())
  const received = parts[2]

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  } catch {
    return false
  }
}

function decodeVerifiedRecruiterJwt(token: string | null | undefined): RecruiterJwtLookup | null {
  if (!token || !verifyHs256Jwt(token)) {
    return null
  }

  const claims = parseJwtClaims(token)
  const userId = claims?.userId?.trim()
  const organizationId = (claims?.orgId ?? claims?.organizationId)?.trim()

  if (
    claims?.role !== "recruiter" ||
    !userId ||
    !organizationId ||
    !UUID_REGEX.test(userId) ||
    !UUID_REGEX.test(organizationId)
  ) {
    return null
  }

  return {
    user_id: userId,
    organization_id: organizationId,
    email: claims?.email?.trim().toLowerCase(),
  }
}

function parseSupabaseAuthCookieValue(rawValue: string): string | null {
  if (!rawValue) {
    return null
  }

  let decoded = rawValue

  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    decoded = rawValue
  }

  if (decoded.startsWith("base64-")) {
    const base64Payload = decoded.slice("base64-".length)
    const base64Decoded = decodeBase64Url(base64Payload)
    if (base64Decoded) {
      decoded = base64Decoded
    }
  }

  try {
    const parsed = JSON.parse(decoded) as
      | { access_token?: string; accessToken?: string }
      | string[]
      | [string, string, unknown?, unknown?, unknown?]

    if (Array.isArray(parsed)) {
      const firstString = parsed.find((item) => typeof item === "string" && item.split(".").length >= 2)
      return typeof firstString === "string" ? firstString : null
    }

    if (parsed && typeof parsed === "object") {
      return parsed.access_token ?? parsed.accessToken ?? null
    }

    return null
  } catch {
    const trimmed = decoded.trim()
    return trimmed.split(".").length >= 2 ? trimmed : null
  }
}

function extractSupabaseJwtFromCookies(cookieMap: Record<string, string>): string | null {
  const authCookieKeys = Object.keys(cookieMap).filter((key) => key.startsWith("sb-") && key.includes("-auth-token"))
  if (authCookieKeys.length === 0) {
    return null
  }

  const grouped: Record<string, string[]> = {}

  authCookieKeys.forEach((key) => {
    const chunkMatch = key.match(/^(.*)\.(\d+)$/)
    if (chunkMatch) {
      const base = chunkMatch[1]
      const index = Number(chunkMatch[2])
      if (!grouped[base]) {
        grouped[base] = []
      }
      grouped[base][index] = cookieMap[key]
      return
    }

    grouped[key] = [cookieMap[key]]
  })

  for (const baseKey of Object.keys(grouped)) {
    const chunks = grouped[baseKey].filter(Boolean)
    const combined = chunks.join("")
    const accessToken = parseSupabaseAuthCookieValue(combined)
    if (accessToken) {
      return accessToken
    }
  }

  return null
}

function extractJwtFromRequest(request: Request, cookieMap: Record<string, string>): string | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token) {
      return token
    }
  }

  const supabaseJwt = extractSupabaseJwtFromCookies(cookieMap)
  if (supabaseJwt) {
    return supabaseJwt
  }

  return (
    normalizeCookieValue(cookieMap.authToken) ||
    normalizeCookieValue(cookieMap.accessToken) ||
    normalizeCookieValue(cookieMap.access_token) ||
    normalizeCookieValue(cookieMap.token)
  )
}

function extractJwtCandidatesFromRequest(
  request: Request,
  cookieHeader: string | null,
  cookieMap: Record<string, string>
) {
  const candidates: Array<string | null | undefined> = []
  const authHeader = request.headers.get("authorization")

  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    candidates.push(authHeader.slice(7).trim())
  }

  candidates.push(extractSupabaseJwtFromCookies(cookieMap))

  for (const name of ["authToken", "accessToken", "access_token", "token"]) {
    candidates.push(cookieMap[name])
    candidates.push(...getCookieValues(cookieHeader, name))
  }

  return uniqueNormalizedValues(candidates)
}

export function getAuthTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie")
  const cookieMap = parseCookieHeader(cookieHeader)
  return extractJwtCandidatesFromRequest(request, cookieHeader, cookieMap)[0] ?? null
}

export function getVerisnovaSessionFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie")
  const cookieMap = parseCookieHeader(cookieHeader)
  return uniqueNormalizedValues([
    cookieMap.hireveri_session,
    ...getCookieValues(cookieHeader, "hireveri_session"),
  ])[0] ?? null
}

async function lookupIdentityFromSupabaseSession(sessionId: string): Promise<string | null> {
  try {
    const sessionRows = await prisma.$queryRaw<AuthIdentityRow[]>(Prisma.sql`
      select s.user_id::text as identity_id
      from auth.sessions s
      where s.id::text = ${sessionId}
      limit 1
    `)

    if (sessionRows[0]?.identity_id) {
      return sessionRows[0].identity_id
    }
  } catch (error) {
    console.warn("Supabase auth.sessions lookup failed", error)
  }

  try {
    const refreshRows = await prisma.$queryRaw<AuthIdentityRow[]>(Prisma.sql`
      select rt.user_id::text as identity_id
      from auth.refresh_tokens rt
      where rt.id::text = ${sessionId}
         or rt.session_id::text = ${sessionId}
      limit 1
    `)

    if (refreshRows[0]?.identity_id) {
      return refreshRows[0].identity_id
    }
  } catch (error) {
    console.warn("Supabase auth.refresh_tokens lookup failed", error)
  }

  return null
}

async function lookupRecruiterByIdentity(
  identityId: string
): Promise<RecruiterLookupRow | null> {
  let recruiterRows

  try {
    recruiterRows = await prisma.$queryRaw<RecruiterLookupRow[]>(Prisma.sql`
      select u.user_id::text as user_id,
             u.organization_id::text as organization_id
      from public.users u
      inner join public.organizations o
        on o.organization_id = u.organization_id
       and o.is_active = true
      where u.identity_id::text = ${identityId}
        and u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
        and u.is_active = true
      limit 1
    `)
  } catch (error) {
    throwRecruiterLookupFailed("Recruiter user lookup failed", error)
  }

  return recruiterRows[0] ?? null
}

async function lookupRecruiterByUserOrg(
  userId: string,
  organizationId: string
): Promise<RecruiterLookupRow | null> {
  let recruiterRows

  try {
    recruiterRows = await prisma.$queryRaw<RecruiterLookupRow[]>(Prisma.sql`
      select u.user_id::text as user_id,
             u.organization_id::text as organization_id
      from public.users u
      where u.user_id::text = ${userId}
        and u.organization_id::text = ${organizationId}
        and u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
        and u.is_active = true
      limit 1
    `)
  } catch (error) {
    throwRecruiterLookupFailed("Recruiter token lookup failed", error)
  }

  return recruiterRows[0] ?? null
}

async function lookupRecruiterByEmailOrg(
  email: string,
  organizationId: string
): Promise<RecruiterLookupRow | null> {
  let recruiterRows

  try {
    recruiterRows = await prisma.$queryRaw<RecruiterLookupRow[]>(Prisma.sql`
      select u.user_id::text as user_id,
             u.organization_id::text as organization_id
      from public.users u
      where lower(u.email) = ${email}
        and u.organization_id::text = ${organizationId}
        and u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
        and u.is_active = true
      order by u.created_at asc
      limit 1
    `)
  } catch (error) {
    throwRecruiterLookupFailed("Recruiter token email lookup failed", error)
  }

  return recruiterRows[0] ?? null
}

async function repairRecruiterByEmailOrg(
  email: string,
  organizationId: string
): Promise<RecruiterLookupRow | null> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      update public.users
      set
        role = case
          when role in ('RECRUITER', 'ADMIN', 'ORG_OWNER') then role
          else 'RECRUITER'
        end,
        is_active = true,
        is_email_verified = true
      where lower(email) = ${email}
        and organization_id::text = ${organizationId}
    `)
  } catch (error) {
    console.warn("Trusted recruiter email repair failed", error)
    return null
  }

  return lookupRecruiterByEmailOrg(email, organizationId)
}

async function ensureRecruiterUserFromTrustedAuth(input: {
  userId: string
  organizationId: string
  email: string
}): Promise<RecruiterLookupRow | null> {
  const email = input.email.trim().toLowerCase()

  if (!email || !UUID_REGEX.test(input.userId) || !UUID_REGEX.test(input.organizationId)) {
    return null
  }

  await ensureRecruiterOrganization({
    organizationId: input.organizationId,
    email,
  })

  try {
    await prisma.$executeRaw(Prisma.sql`
      insert into public.users (
        user_id,
        organization_id,
        full_name,
        email,
        role,
        is_active,
        is_email_verified,
        created_at
      )
      values (
        ${input.userId}::uuid,
        ${input.organizationId}::uuid,
        split_part(${email}, '@', 1),
        ${email},
        'RECRUITER',
        true,
        true,
        now()
      )
      on conflict (user_id) do update
      set
        organization_id = excluded.organization_id,
        email = excluded.email,
        role = case
          when public.users.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER') then public.users.role
          else excluded.role
        end,
        is_active = true,
        is_email_verified = true
    `)
  } catch (error) {
    console.warn("Trusted recruiter user upsert without auth_user_id failed", error)
    return null
  }

  try {
    await prisma.$queryRaw(Prisma.sql`
      select public.fn_ensure_default_recruiter_profile(
        ${input.userId}::uuid,
        ${input.organizationId}::uuid
      )
    `)
  } catch (error) {
    console.warn("Trusted recruiter profile auto-heal skipped", error)
  }

  return lookupRecruiterByUserOrg(input.userId, input.organizationId)
}

async function resolveTrustedRecruiterByUserOrgOrEmail(input: {
  userId: string
  organizationId: string
  email?: string | null
}): Promise<RecruiterLookupRow | null> {
  const email = input.email?.trim().toLowerCase()

  await ensureRecruiterOrganization({
    organizationId: input.organizationId,
    email,
  })

  let recruiter = await lookupRecruiterByUserOrg(input.userId, input.organizationId)

  if (!recruiter && email) {
    recruiter = await lookupRecruiterByEmailOrg(email, input.organizationId)
  }

  if (!recruiter && email) {
    recruiter = await repairRecruiterByEmailOrg(email, input.organizationId)
  }

  if (!recruiter && email) {
    recruiter = await ensureRecruiterUserFromTrustedAuth({
      userId: input.userId,
      organizationId: input.organizationId,
      email,
    })
  }

  return recruiter
}

async function lookupRecruiterViaAuthService(sessionId: string): Promise<RecruiterLookupRow | null> {
  const cached = getCachedAuthServiceRecruiter(sessionId)

  if (cached) {
    return cached
  }

  const inFlight = getAuthServiceInFlightMap()
  const existing = inFlight.get(sessionId)

  if (existing) {
    return existing
  }

  const promise = lookupRecruiterViaAuthServiceUncached(sessionId)
  inFlight.set(sessionId, promise)

  try {
    const recruiter = await promise

    if (recruiter?.user_id && recruiter.organization_id) {
      setCachedAuthServiceRecruiter(sessionId, recruiter)
    }

    return recruiter
  } finally {
    inFlight.delete(sessionId)
  }
}

async function lookupRecruiterViaAuthServiceUncached(sessionId: string): Promise<RecruiterLookupRow | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const url = new URL("/api/auth/recruiter-session", AUTH_APP_URL)
    const response = await fetch(url, {
      headers: {
        cookie: `hireveri_session=${encodeURIComponent(sessionId)}`,
      },
      cache: "no-store",
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn("Recruiter auth service session validation failed", {
        status: response.status,
      })
      return null
    }

    const payload = (await response.json()) as AuthServiceRecruiterSession
    const userId = payload.userId?.trim()
    const organizationId = payload.organizationId?.trim()
    const email = payload.email?.trim().toLowerCase()

    if (!userId || !organizationId || !UUID_REGEX.test(userId) || !UUID_REGEX.test(organizationId)) {
      console.warn("Recruiter auth service returned invalid session payload")
      return null
    }

    const recruiter = await resolveTrustedRecruiterByUserOrgOrEmail({ userId, organizationId, email })
    return recruiter?.user_id && recruiter.organization_id ? recruiter : null
  } catch (error) {
    console.warn("Recruiter auth service session lookup failed", error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function lookupRecruiterViaAuthTokenService(token: string): Promise<RecruiterLookupRow | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const url = new URL("/api/auth/recruiter-token", AUTH_APP_URL)
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as AuthServiceRecruiterToken
    const userId = payload.userId?.trim()
    const organizationId = payload.organizationId?.trim()
    const email = payload.email?.trim().toLowerCase()

    if (!userId || !organizationId || !UUID_REGEX.test(userId) || !UUID_REGEX.test(organizationId)) {
      return null
    }

    return resolveTrustedRecruiterByUserOrgOrEmail({ userId, organizationId, email })
  } catch (error) {
    console.warn("Recruiter auth service token lookup failed", error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchAuthUserEmail(identityId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<AuthUserRow[]>(Prisma.sql`
      select u.email
      from auth.users u
      where u.id::text = ${identityId}
      limit 1
    `)

    const email = rows[0]?.email
    return email ? email.trim().toLowerCase() : null
  } catch (error) {
    console.warn("Supabase auth.users lookup failed", error)
  }

  return null
}

async function reconcileRecruiterIdentity(
  identityId: string
): Promise<RecruiterLookupRow | null> {
  const email = await fetchAuthUserEmail(identityId)

  if (!email) {
    return null
  }

  let recruiterRows

  try {
    recruiterRows = await prisma.$queryRaw<RecruiterLookupRow[]>(Prisma.sql`
      select u.user_id::text as user_id,
             u.organization_id::text as organization_id
      from public.users u
      inner join public.organizations o
        on o.organization_id = u.organization_id
       and o.is_active = true
      where lower(u.email) = ${email}
        and u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
        and u.is_active = true
      limit 1
    `)

    const recruiter = recruiterRows?.[0]

    if (recruiter?.user_id) {
      await prisma.$queryRaw(Prisma.sql`
        update public.users
        set identity_id = ${identityId}::uuid
        where user_id::text = ${recruiter.user_id}
      `)
    }

    return recruiter ?? null
  } catch (error) {
    console.error("Recruiter identity reconciliation failed", error)
    return null
  }
}

// reactivateAuthSessionIfNeeded() lived here. It was already unused, and it
// directly contradicts the idle-timeout policy in lookupActiveAuthSession():
// resurrecting a deactivated row would undo an idle expiry. Removed rather than
// left as a trap.

async function lookupDevBypassRecruiter(): Promise<RecruiterLookupRow | null> {
  try {
    const recruiterRows = await prisma.$queryRaw<RecruiterLookupRow[]>(Prisma.sql`
      select u.user_id::text as user_id,
             u.organization_id::text as organization_id
      from public.users u
      left join public.job_positions jp
        on jp.organization_id = u.organization_id
      left join public.jobs sj
        on sj.organization_id = u.organization_id
      where u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
        and u.is_active = true
      group by u.user_id, u.organization_id, u.created_at
      order by
        max(sj.created_at) desc nulls last,
        count(distinct sj.id) desc,
        count(distinct jp.job_id) desc,
        u.created_at asc
      limit 1
    `)

    return recruiterRows[0] ?? null
  } catch (error) {
    throwRecruiterLookupFailed("Recruiter dev bypass lookup failed", error)
  }
}

/**
 * Resolves a hireveri_session cookie against auth_sessions and, in the same
 * statement, applies the inactivity policy:
 *
 * - idle within IDLE_SESSION_TIMEOUT_HOURS -> last_seen_at is bumped, so an
 *   in-use session stays alive indefinitely (up to expires_at).
 * - idle beyond it -> the row is deactivated and returned with
 *   idle_expired = true, so the caller can fail the request instead of letting
 *   a stale session fall through to the identity/auth-service fallbacks.
 *
 * Sessions are no longer unique per identity, so several devices can hold live
 * sessions at once; each one ages out on its own last_seen_at.
 */
async function lookupActiveAuthSession(sessionId: string): Promise<AuthSessionRow | null> {
  if (!UUID_REGEX.test(sessionId)) {
    return null
  }

  try {
    const sessionRows = await prisma.$queryRaw<AuthSessionRow[]>(Prisma.sql`
      update public.auth_sessions s
      set
        is_active = case
          when s.last_seen_at <= now() - make_interval(hours => ${IDLE_SESSION_TIMEOUT_HOURS}::int) then false
          else s.is_active
        end,
        last_seen_at = case
          when s.last_seen_at <= now() - make_interval(hours => ${IDLE_SESSION_TIMEOUT_HOURS}::int) then s.last_seen_at
          else now()
        end
      where s.session_id::text = ${sessionId}
        and s.is_active = true
        and (s.expires_at is null or s.expires_at > now())
      returning
        s.session_id::text as session_id,
        s.identity_id::text as identity_id,
        s.is_active,
        (s.is_active = false) as idle_expired
    `)

    return sessionRows[0] ?? null
  } catch (error) {
    console.warn("Recruiter auth session lookup skipped", error)
    return null
  }
}

async function lookupRecruiterForIdentity(identityId: string): Promise<RecruiterLookupRow | null> {
  let recruiter = await lookupRecruiterByIdentity(identityId)

  if (!recruiter) {
    recruiter = await reconcileRecruiterIdentity(identityId)
  }

  return recruiter
}

export async function getRecruiterRequestContext(request: Request): Promise<RecruiterRequestContext> {
  const cookieHeader = request.headers.get("cookie")
  const cookieMap = parseCookieHeader(cookieHeader)
  const sessionCandidates = uniqueNormalizedValues([
    cookieMap.hireveri_session,
    ...getCookieValues(cookieHeader, "hireveri_session"),
  ])
  const jwtCandidates = extractJwtCandidatesFromRequest(request, cookieHeader, cookieMap)
  const sessionCookiePresent = sessionCandidates.length > 0

  for (const jwt of jwtCandidates) {
    const recruiterJwt = decodeVerifiedRecruiterJwt(jwt)

    if (!recruiterJwt) {
      continue
    }

    const cacheKey = `jwt:${recruiterJwt.user_id}:${recruiterJwt.organization_id}`
    let recruiter = getCachedAuthServiceRecruiter(cacheKey)

    if (!recruiter) {
      recruiter = await resolveTrustedRecruiterByUserOrgOrEmail({
        userId: recruiterJwt.user_id,
        organizationId: recruiterJwt.organization_id,
        email: recruiterJwt.email,
      })

      if (recruiter?.user_id && recruiter.organization_id) {
        setCachedAuthServiceRecruiter(cacheKey, recruiter)
      }
    }

    if (recruiter?.user_id && recruiter.organization_id) {
      return {
        userId: recruiter.user_id,
        organizationId: recruiter.organization_id,
        sessionCookiePresent,
        sessionCookieMatched: true,
        sessionValidatedVia: "jwt",
      }
    }
  }

  const jwtIdentityCandidates = uniqueNormalizedValues(jwtCandidates.map((jwt) => decodeJwtSub(jwt)))

  if (!sessionCookiePresent && jwtCandidates.length === 0 && jwtIdentityCandidates.length === 0) {
    if (DEV_AUTH_BYPASS) {
      const recruiter = await lookupDevBypassRecruiter()
      if (recruiter?.user_id && recruiter.organization_id) {
        return {
          userId: recruiter.user_id,
          organizationId: recruiter.organization_id,
          sessionCookiePresent: false,
          sessionCookieMatched: false,
          sessionValidatedVia: "identity_cookie",
        }
      }
    }

    throw new ApiError(401, "SESSION_COOKIE_MISSING", "Authenticated recruiter session is missing")
  }

  for (const sessionId of sessionCandidates) {
    const recruiter = getCachedAuthServiceRecruiter(sessionId)

    if (recruiter?.user_id && recruiter.organization_id) {
      return {
        userId: recruiter.user_id,
        organizationId: recruiter.organization_id,
        sessionCookiePresent: true,
        sessionCookieMatched: true,
        sessionValidatedVia: "auth_session",
      }
    }
  }

  for (const sessionId of sessionCandidates) {
    const matchedSession = await lookupActiveAuthSession(sessionId)

    if (!matchedSession?.identity_id) {
      continue
    }

    // The recruiter has been inactive past the idle window. Fail here rather
    // than falling through to the auth-service / identity-cookie fallbacks —
    // those would happily re-authenticate a session we just retired.
    if (matchedSession.idle_expired) {
      clearCachedAuthServiceRecruiter(sessionId)
      throw new ApiError(
        401,
        "SESSION_IDLE_TIMEOUT",
        `Recruiter session expired after ${IDLE_SESSION_TIMEOUT_HOURS} hours of inactivity`
      )
    }

    const recruiter = await lookupRecruiterForIdentity(matchedSession.identity_id)

    if (recruiter?.user_id && recruiter.organization_id) {
      setCachedAuthServiceRecruiter(sessionId, recruiter)
      return {
        userId: recruiter.user_id,
        organizationId: recruiter.organization_id,
        sessionCookiePresent: true,
        sessionCookieMatched: true,
        sessionValidatedVia: "auth_session",
      }
    }
  }

  for (const sessionId of sessionCandidates) {
    const recruiter = await lookupRecruiterViaAuthService(sessionId)

    if (recruiter?.user_id && recruiter.organization_id) {
      return {
        userId: recruiter.user_id,
        organizationId: recruiter.organization_id,
        sessionCookiePresent: true,
        sessionCookieMatched: true,
        sessionValidatedVia: "auth_session",
      }
    }
  }

  const identityCandidates = [...jwtIdentityCandidates]

  for (const sessionId of sessionCandidates) {
    const identityId = await lookupIdentityFromSupabaseSession(sessionId)
    if (identityId) {
      identityCandidates.push(identityId)
    }
  }

  for (const identityId of uniqueNormalizedValues(identityCandidates)) {
    const recruiter = await lookupRecruiterForIdentity(identityId)

    if (recruiter?.user_id && recruiter.organization_id) {
      return {
        userId: recruiter.user_id,
        organizationId: recruiter.organization_id,
        sessionCookiePresent,
        sessionCookieMatched: Boolean(sessionCookiePresent || jwtIdentityCandidates.includes(identityId)),
        sessionValidatedVia: jwtIdentityCandidates.includes(identityId) ? "jwt" : "identity_cookie",
      }
    }
  }

  for (const jwt of jwtCandidates) {
    if (decodeVerifiedRecruiterJwt(jwt)) {
      continue
    }

    const authServiceRecruiter = await lookupRecruiterViaAuthTokenService(jwt)

    if (authServiceRecruiter?.user_id && authServiceRecruiter.organization_id) {
      return {
        userId: authServiceRecruiter.user_id,
        organizationId: authServiceRecruiter.organization_id,
        sessionCookiePresent,
        sessionCookieMatched: sessionCookiePresent,
        sessionValidatedVia: "jwt",
      }
    }
  }

  if (DEV_AUTH_BYPASS) {
    const recruiter = await lookupDevBypassRecruiter()
    if (recruiter?.user_id && recruiter.organization_id) {
      return {
        userId: recruiter.user_id,
        organizationId: recruiter.organization_id,
        sessionCookiePresent,
        sessionCookieMatched: false,
        sessionValidatedVia: "identity_cookie",
      }
    }
  }

  if (jwtIdentityCandidates.length > 0) {
    throw new ApiError(401, "RECRUITER_NOT_FOUND", "Recruiter not found for the authenticated session")
  }

  throw new ApiError(401, "INVALID_SESSION", "Authenticated recruiter session is invalid or expired")
}
