import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"
import { ApiError, isApiError } from "@/lib/server/errors"
import { toFunctionApiError } from "@/lib/server/function-errors"
import { getInterviewAppUrl } from "@/lib/server/interview-url"

export type ValidateInterviewTokenInput = {
  token: string
}

export type ValidateInterviewTokenResult = {
  valid: boolean
  reason?: "INVALID_TOKEN" | "INACTIVE" | "EXPIRED" | "USED" | "INVALID_TIME_WINDOW" | "NOT_STARTED"
  interviewId?: string
  candidateId?: string
}

export type CreateInterviewLinkInput = {
  jobId?: string
  job_id?: string
  candidateId?: string
  candidate_id?: string
  organizationId?: string
  accessType?: "FLEXIBLE" | "SCHEDULED"
  startTime?: string
  start_time?: string
  endTime?: string
  end_time?: string
  createdBy?: string | null
}

export type UpdateInterviewInviteInput = {
  inviteId: string
  organizationId: string
  accessType: "FLEXIBLE" | "SCHEDULED"
  startTime?: string | null
  endTime?: string | null
}

export type RevokeInterviewInviteInput = {
  inviteId: string
  organizationId: string
  reason?: string | null
}

type CreateInterviewLinkRow = {
  interview_id: string
  token: string
  link: string
}

type LatestInviteByEmailRow = {
  sent_at: string
}

type ValidateInterviewTokenRow = {
  valid: boolean
  reason: ValidateInterviewTokenResult["reason"] | null
  interview_id: string | null
  candidate_id: string | null
}

type UpdateInterviewInviteRow = {
  invite_id: string
  interview_id: string
  access_type: string
  start_time: string | null
  end_time: string | null
  expires_at: string | null
  status: string
}

type RevokeInterviewInviteRow = {
  invite_id: string
  interview_id: string
  status: string
  revoked_at: string | null
  revoked_reason: string | null
}

type InviteScopeRow = {
  invite_id: string
  interview_id: string
  status: string | null
  used_at: string | null
}

type InviteColumnSupportRow = {
  has_updated_at: boolean
  has_revoked_at: boolean
  has_revoked_reason: boolean
}

type InviteTrackingColumnSupportRow = {
  has_company_id: boolean
  has_job_id: boolean
  has_candidate_email: boolean
  has_sent_at: boolean
}

async function getInviteTrackingColumnSupport() {
  const rows = await prisma.$queryRaw<InviteTrackingColumnSupportRow[]>(Prisma.sql`
    select
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'interview_invites' and column_name = 'company_id'
      ) as has_company_id,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'interview_invites' and column_name = 'job_id'
      ) as has_job_id,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'interview_invites' and column_name = 'candidate_email'
      ) as has_candidate_email,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'interview_invites' and column_name = 'sent_at'
      ) as has_sent_at
  `)

  return rows[0] ?? {
    has_company_id: false,
    has_job_id: false,
    has_candidate_email: false,
    has_sent_at: false,
  }
}

export async function getLatestInterviewInviteForEmail(input: {
  companyId: string
  candidateEmail: string
}) {
  const email = input.candidateEmail.trim().toLowerCase()

  if (!input.companyId || !email) {
    return null
  }

  const columnSupport = await getInviteTrackingColumnSupport()

  if (!columnSupport.has_company_id || !columnSupport.has_candidate_email || !columnSupport.has_sent_at) {
    return null
  }

  const rows = await prisma.$queryRaw<LatestInviteByEmailRow[]>(Prisma.sql`
    select sent_at::text
    from public.interview_invites
    where company_id = ${input.companyId}::uuid
      and candidate_email = ${email}
    order by sent_at desc
    limit 1
  `)

  const latest = rows[0]

  return latest?.sent_at
    ? {
        lastSentAt: latest.sent_at,
      }
    : null
}

export async function recordInterviewInviteTracking(input: {
  interviewId: string
  companyId: string
  jobId: string
  candidateEmail: string
}) {
  const columnSupport = await getInviteTrackingColumnSupport()

  if (!columnSupport.has_company_id || !columnSupport.has_candidate_email || !columnSupport.has_sent_at) {
    return null
  }

  const rows = columnSupport.has_job_id
    ? await prisma.$queryRaw<{ invite_id: string }[]>(Prisma.sql`
    update public.interview_invites
    set
      company_id = ${input.companyId}::uuid,
      job_id = case
        when exists (select 1 from public.jobs where id = ${input.jobId}::uuid)
          then ${input.jobId}::uuid
        else job_id
      end,
      candidate_email = lower(${input.candidateEmail}),
      sent_at = coalesce(sent_at, now())
    where interview_id = ${input.interviewId}::uuid
    returning invite_id::text
  `)
    : await prisma.$queryRaw<{ invite_id: string }[]>(Prisma.sql`
    update public.interview_invites
    set
      company_id = ${input.companyId}::uuid,
      candidate_email = lower(${input.candidateEmail}),
      sent_at = coalesce(sent_at, now())
    where interview_id = ${input.interviewId}::uuid
    returning invite_id::text
  `)

  return rows[0]?.invite_id ?? null
}

async function getInviteForOrganization(inviteId: string, organizationId: string) {
  const rows = await prisma.$queryRaw<InviteScopeRow[]>(Prisma.sql`
    select
      ii.invite_id,
      ii.interview_id,
      ii.status,
      ii.used_at
    from public.interview_invites ii
    inner join public.interviews i on i.interview_id = ii.interview_id
    where ii.invite_id = ${inviteId}::uuid
      and i.organization_id = ${organizationId}::uuid
    limit 1
  `)

  return rows[0] ?? null
}

async function getInviteColumnSupport() {
  const rows = await prisma.$queryRaw<InviteColumnSupportRow[]>(Prisma.sql`
    select
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'interview_invites'
          and column_name = 'updated_at'
      ) as has_updated_at,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'interview_invites'
          and column_name = 'revoked_at'
      ) as has_revoked_at,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'interview_invites'
          and column_name = 'revoked_reason'
      ) as has_revoked_reason
  `)

  return rows[0] ?? {
    has_updated_at: false,
    has_revoked_at: false,
    has_revoked_reason: false,
  }
}

async function updateInterviewInviteFallback(input: UpdateInterviewInviteInput) {
  const invite = await getInviteForOrganization(input.inviteId, input.organizationId)

  if (!invite?.invite_id) {
    throw new ApiError(404, "INTERVIEW_INVITE_NOT_FOUND", "Interview invite not found")
  }

  if (invite.used_at) {
    throw new ApiError(409, "INTERVIEW_INVITE_LOCKED", "Interview invite can no longer be changed")
  }

  if (String(invite.status ?? "ACTIVE").toUpperCase() !== "ACTIVE") {
    throw new ApiError(409, "INTERVIEW_INVITE_INACTIVE", "Interview invite is no longer active")
  }

  const accessType = String(input.accessType ?? "FLEXIBLE").toUpperCase()

  if (accessType !== "FLEXIBLE" && accessType !== "SCHEDULED") {
    throw new ApiError(400, "INVALID_ACCESS_TYPE", "Invalid interview access type")
  }

  if (accessType === "SCHEDULED" && (!input.startTime || !input.endTime)) {
    throw new ApiError(400, "INVALID_TIME", "Start and end time required")
  }

  const startTime = accessType === "SCHEDULED" && input.startTime ? new Date(input.startTime) : null
  const endTime = accessType === "SCHEDULED" && input.endTime ? new Date(input.endTime) : null

  if (accessType === "SCHEDULED") {
    if (!startTime || !endTime || Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || startTime >= endTime) {
      throw new ApiError(400, "INVALID_TIME", "Invalid interview time window")
    }
  }

  const expiresAt = accessType === "SCHEDULED"
    ? endTime?.toISOString() ?? null
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const columnSupport = await getInviteColumnSupport()
  const updateClauses = [
    Prisma.sql`access_type = ${accessType}`,
    Prisma.sql`start_time = ${startTime ? startTime.toISOString() : null}::timestamptz`,
    Prisma.sql`end_time = ${endTime ? endTime.toISOString() : null}::timestamptz`,
    Prisma.sql`expires_at = ${expiresAt}::timestamptz`,
  ]

  if (columnSupport.has_updated_at) {
    updateClauses.push(Prisma.sql`updated_at = now()`)
  }

  await prisma.$executeRaw(Prisma.sql`
    update public.interview_invites
    set ${Prisma.join(updateClauses, ", ")}
    where invite_id = ${input.inviteId}::uuid
  `)

  const rows = await prisma.$queryRaw<UpdateInterviewInviteRow[]>(Prisma.sql`
    select
      ii.invite_id,
      ii.interview_id,
      ii.access_type,
      ii.start_time,
      ii.end_time,
      ii.expires_at,
      coalesce(ii.status, 'ACTIVE') as status
    from public.interview_invites ii
    where ii.invite_id = ${input.inviteId}::uuid
    limit 1
  `)

  const result = rows[0]

  if (!result?.invite_id) {
    throw new ApiError(500, "INTERVIEW_INVITE_UPDATE_FAILED", "Failed to update interview invite")
  }

  return {
    inviteId: result.invite_id,
    interviewId: result.interview_id,
    accessType: result.access_type,
    startTime: result.start_time,
    endTime: result.end_time,
    expiresAt: result.expires_at,
    status: result.status,
  }
}

async function revokeInterviewInviteFallback(input: RevokeInterviewInviteInput) {
  const invite = await getInviteForOrganization(input.inviteId, input.organizationId)

  if (!invite?.invite_id) {
    throw new ApiError(404, "INTERVIEW_INVITE_NOT_FOUND", "Interview invite not found")
  }

  if (invite.used_at) {
    throw new ApiError(409, "INTERVIEW_INVITE_LOCKED", "Interview invite can no longer be changed")
  }

  if (String(invite.status ?? "ACTIVE").toUpperCase() !== "ACTIVE") {
    throw new ApiError(409, "INTERVIEW_INVITE_INACTIVE", "Interview invite is no longer active")
  }

  const reason = input.reason?.trim() ? input.reason.trim() : null
  const columnSupport = await getInviteColumnSupport()
  const updateClauses = [Prisma.sql`expires_at = now()`]

  if (columnSupport.has_revoked_at) {
    updateClauses.push(Prisma.sql`revoked_at = now()`)
  }

  if (columnSupport.has_revoked_reason) {
    updateClauses.push(Prisma.sql`revoked_reason = ${reason}`)
  }

  if (columnSupport.has_updated_at) {
    updateClauses.push(Prisma.sql`updated_at = now()`)
  }

  await prisma.$executeRaw(Prisma.sql`
    update public.interview_invites
    set ${Prisma.join(updateClauses, ", ")}
    where invite_id = ${input.inviteId}::uuid
  `)

  const revokedRows = await prisma.$queryRaw<RevokeInterviewInviteRow[]>(Prisma.sql`
    select
      ii.invite_id,
      ii.interview_id,
      coalesce(ii.status, 'EXPIRED') as status,
      ${columnSupport.has_revoked_at ? Prisma.raw("ii.revoked_at") : Prisma.raw("null::timestamptz")} as revoked_at,
      ${columnSupport.has_revoked_reason ? Prisma.raw("ii.revoked_reason") : Prisma.raw("null::text")} as revoked_reason
    from public.interview_invites ii
    where ii.invite_id = ${input.inviteId}::uuid
    limit 1
  `)

  const result = revokedRows[0]

  if (!result?.invite_id) {
    throw new ApiError(500, "INTERVIEW_INVITE_REVOKE_FAILED", "Failed to revoke interview invite")
  }

  return {
    inviteId: result.invite_id,
    interviewId: result.interview_id,
    status: result.status,
    revokedAt: result.revoked_at,
    revokedReason: result.revoked_reason,
  }
}

export async function createInterviewLink(input: CreateInterviewLinkInput) {
  const jobId = String(input.jobId ?? input.job_id ?? "").trim()
  const candidateId = String(input.candidateId ?? input.candidate_id ?? "").trim()
  const organizationId = String(input.organizationId ?? "").trim()

  if (!jobId) {
    throw new ApiError(400, "INVALID_JOB_ID", "jobId is required")
  }

  if (!candidateId) {
    throw new ApiError(400, "INVALID_CANDIDATE_ID", "candidateId is required")
  }

  if (!organizationId) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "organizationId is required")
  }

  try {
    const rows = await prisma.$queryRaw<CreateInterviewLinkRow[]>(Prisma.sql`
      select *
      from public.fn_create_interview_link(
        ${organizationId}::uuid,
        ${jobId}::uuid,
        ${candidateId}::uuid,
        ${input.accessType ?? "FLEXIBLE"},
        ${input.startTime ?? input.start_time ?? null}::timestamptz,
        ${input.endTime ?? input.end_time ?? null}::timestamptz,
        ${getInterviewAppUrl()},
        ${input.createdBy ?? null}::uuid
      )
    `)

    const result = rows[0]

    if (!result?.interview_id || !result?.link) {
      throw new ApiError(500, "INTERVIEW_LINK_CREATE_FAILED", "Failed to create interview link")
    }

    return {
      link: result.link,
      interviewId: result.interview_id,
      token: result.token,
    }
  } catch (error) {
    throw toFunctionApiError(error, {
      statusCode: 500,
      code: "INTERVIEW_LINK_CREATE_FAILED",
      message: "Failed to create interview link",
    })
  }
}

export async function updateInterviewInvite(input: UpdateInterviewInviteInput) {
  try {
    const rows = await prisma.$queryRaw<UpdateInterviewInviteRow[]>(Prisma.sql`
      select *
      from public.fn_update_interview_invite(
        ${input.organizationId}::uuid,
        ${input.inviteId}::uuid,
        ${input.accessType},
        ${input.startTime ?? null}::timestamptz,
        ${input.endTime ?? null}::timestamptz
      )
    `)

    const result = rows[0]

    if (!result?.invite_id) {
      throw new ApiError(500, "INTERVIEW_INVITE_UPDATE_FAILED", "Failed to update interview invite")
    }

    return {
      inviteId: result.invite_id,
      interviewId: result.interview_id,
      accessType: result.access_type,
      startTime: result.start_time,
      endTime: result.end_time,
      expiresAt: result.expires_at,
      status: result.status,
    }
  } catch (error) {
    try {
      return await updateInterviewInviteFallback(input)
    } catch (fallbackError) {
      if (isApiError(fallbackError)) {
        throw fallbackError
      }

      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Failed to update interview invite"

      throw new ApiError(500, "INTERVIEW_INVITE_UPDATE_FAILED", fallbackMessage)
    }
  }
}

export async function revokeInterviewInvite(input: RevokeInterviewInviteInput) {
  try {
    const rows = await prisma.$queryRaw<RevokeInterviewInviteRow[]>(Prisma.sql`
      select *
      from public.fn_revoke_interview_invite(
        ${input.organizationId}::uuid,
        ${input.inviteId}::uuid,
        ${input.reason ?? null}
      )
    `)

    const result = rows[0]

    if (!result?.invite_id) {
      throw new ApiError(500, "INTERVIEW_INVITE_REVOKE_FAILED", "Failed to revoke interview invite")
    }

    return {
      inviteId: result.invite_id,
      interviewId: result.interview_id,
      status: result.status,
      revokedAt: result.revoked_at,
      revokedReason: result.revoked_reason,
    }
  } catch (error) {
    try {
      return await revokeInterviewInviteFallback(input)
    } catch (fallbackError) {
      if (isApiError(fallbackError)) {
        throw fallbackError
      }

      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Failed to revoke interview invite"

      throw new ApiError(500, "INTERVIEW_INVITE_REVOKE_FAILED", fallbackMessage)
    }
  }
}

export async function validateInterviewToken(
  input: ValidateInterviewTokenInput
): Promise<ValidateInterviewTokenResult> {
  try {
    const rows = await prisma.$queryRaw<ValidateInterviewTokenRow[]>(Prisma.sql`
      select *
      from public.fn_validate_interview_token(${input.token})
    `)

    const result = rows[0]

    if (!result) {
      return {
        valid: false,
        reason: "INVALID_TOKEN",
      }
    }

    return {
      valid: result.valid,
      reason: result.reason ?? undefined,
      interviewId: result.interview_id ?? undefined,
      candidateId: result.candidate_id ?? undefined,
    }
  } catch (error) {
    throw toFunctionApiError(error, {
      statusCode: 500,
      code: "INTERVIEW_TOKEN_VALIDATE_FAILED",
      message: "Failed to validate interview token",
    })
  }
}

export async function markInterviewAsUsed(token: string) {
  const result = await validateInterviewToken({ token })

  if (!result.valid) {
    throw new ApiError(404, result.reason ?? "INVALID_TOKEN", "Token not found or already used")
  }

  return true
}



