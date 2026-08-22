import { Prisma } from "@prisma/client"
import { createHash, createHmac, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"

import { prisma } from "@/lib/server/prisma"

type InviteRow = {
  invite_id: string
  org_id: string
  invited_email: string
  invited_user_id: string | null
  expires_at: string
  status: string
  role_assigned: number
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function getInviteSecret() {
  return process.env.RECRUITER_INVITE_TOKEN_SECRET || process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || "verisnova-dev-invite-secret"
}

function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.RECRUITER_INVITE_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || ""
}

function getRecruiterAppUrl(request: Request) {
  return (
    process.env.RECRUITER_APP_URL ||
    process.env.NEXT_PUBLIC_RECRUITER_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    new URL(request.url).origin
  )
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function signInvitePayload(payload: string) {
  return createHmac("sha256", getInviteSecret()).update(payload).digest("base64url")
}

function verifyInviteToken(token: string) {
  const parts = token.split(".")

  if (parts.length !== 4) {
    return null
  }

  const [inviteId, expiresAtSeconds, nonce, signature] = parts
  const payload = `${inviteId}.${expiresAtSeconds}.${nonce}`
  const expected = signInvitePayload(payload)

  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      return null
    }
  } catch {
    return null
  }

  const expiresAtMs = Number(expiresAtSeconds) * 1000
  if (!inviteId || !Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    return null
  }

  return { inviteId }
}

function createRecruiterJwt(input: { userId: string; organizationId: string; email: string }) {
  const secret = getJwtSecret()

  if (!secret) {
    return ""
  }

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const nowSeconds = Math.floor(Date.now() / 1000)
  const payload = base64UrlEncode(JSON.stringify({
    role: "recruiter",
    userId: input.userId,
    organizationId: input.organizationId,
    orgId: input.organizationId,
    email: input.email,
    iat: nowSeconds,
    exp: nowSeconds + COOKIE_MAX_AGE_SECONDS,
  }))
  const signature = base64UrlEncode(createHmac("sha256", secret).update(`${header}.${payload}`).digest())

  return `${header}.${payload}.${signature}`
}

function cookieOptions(request: Request) {
  const hostname = new URL(request.url).hostname
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1"

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !isLocalhost,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  }
}

function errorRedirect(request: Request, code: string) {
  const url = new URL("/recruiter-access", process.env.AUTH_APP_URL || process.env.NEXT_PUBLIC_AUTH_APP_URL || "https://auth.verisnova.com")
  url.searchParams.set("inviteError", code)
  url.searchParams.set("next", new URL("/", getRecruiterAppUrl(request)).toString())
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("setupToken")?.trim() || url.searchParams.get("token")?.trim() || ""
  const parsedToken = verifyInviteToken(token)

  if (!parsedToken) {
    return errorRedirect(request, "invalid-or-expired")
  }

  const tokenHash = sha256(token)
  const rows = await prisma.$queryRaw<InviteRow[]>(Prisma.sql`
    select
      invite_id::text,
      org_id::text,
      invited_email,
      invited_user_id::text,
      expires_at::text,
      status,
      role_assigned
    from public.recruiter_team_invites
    where invite_id = ${parsedToken.inviteId}::uuid
      and token_hash = ${tokenHash}
    limit 1
  `).catch(() => [] as InviteRow[])

  const invite = rows[0]

  if (!invite || !invite.invited_user_id || new Date(invite.expires_at).getTime() < Date.now()) {
    return errorRedirect(request, "invalid-or-expired")
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      update public.users
      set
        is_active = true,
        is_email_verified = true
      where user_id = ${invite.invited_user_id}::uuid
        and organization_id = ${invite.org_id}::uuid
        and lower(email) = lower(${invite.invited_email})
    `)

    await tx.$executeRaw(Prisma.sql`
      insert into public.recruiter_profiles (
        recruiter_id,
        company_name,
        recruiter_role_id,
        organization_id
      )
      select
        ${invite.invited_user_id}::uuid,
        coalesce(o.organization_name, 'Organization'),
        ${invite.role_assigned}::smallint,
        ${invite.org_id}::uuid
      from public.organizations o
      where o.organization_id = ${invite.org_id}::uuid
      on conflict (recruiter_id) do update
      set
        recruiter_role_id = excluded.recruiter_role_id,
        organization_id = excluded.organization_id,
        company_name = coalesce(public.recruiter_profiles.company_name, excluded.company_name)
    `)

    await tx.$executeRaw(Prisma.sql`
      update public.recruiter_team_invites
      set
        status = 'ACCEPTED',
        accepted_at = coalesce(accepted_at, now()),
        updated_at = now()
      where invite_id = ${invite.invite_id}::uuid
    `)

    await tx.$executeRaw(Prisma.sql`
      insert into public.recruiter_team_invite_audit_logs (
        invite_id,
        invited_by,
        role_assigned,
        org_id,
        invited_email,
        action,
        metadata
      )
      select
        invite_id,
        invited_by,
        role_assigned,
        org_id,
        invited_email,
        'ACCEPTED',
        jsonb_build_object('source', 'team_invite_link')
      from public.recruiter_team_invites
      where invite_id = ${invite.invite_id}::uuid
    `)
  })

  const dashboardUrl = new URL("/", getRecruiterAppUrl(request))
  dashboardUrl.searchParams.set("userId", invite.invited_user_id)
  dashboardUrl.searchParams.set("organizationId", invite.org_id)

  const response = NextResponse.redirect(dashboardUrl)
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")

  const recruiterJwt = createRecruiterJwt({
    userId: invite.invited_user_id,
    organizationId: invite.org_id,
    email: invite.invited_email,
  })

  if (recruiterJwt) {
    const options = cookieOptions(request)
    response.cookies.set("authToken", recruiterJwt, options)
    response.cookies.set("accessToken", recruiterJwt, options)
    response.cookies.set("access_token", recruiterJwt, options)
    response.cookies.set("token", recruiterJwt, options)
  }

  return response
}
