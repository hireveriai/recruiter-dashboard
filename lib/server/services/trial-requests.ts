import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

export const RECRUITER_TRIAL_AI_INTERVIEWS = 10
export const RECRUITER_TRIAL_VERIS_SCREENINGS = 25

export type TrialRequestStatus =
  | "NOT_REQUESTED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"

export type RecruiterTrialState = {
  organizationId: string
  status: TrialRequestStatus
  requestId: string | null
  requestedAt: string | null
  decidedAt: string | null
  /** Internal reason code. Never surfaced verbatim to the requester. */
  decisionReason: string | null
  granted: boolean
  grantedAt: string | null
  expiresAt: string | null
  interviewCreditsRemaining: number
  screeningCreditsRemaining: number
  offer: {
    aiInterviews: number
    verisScreenings: number
  }
}

export type TrialRequestOrigin = {
  ip?: string | null
  userAgent?: string | null
  deviceHash?: string | null
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Postgres raises these with a bare message; map them onto the API contract so
 * the client gets a stable code rather than a 500.
 */
const DB_ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  TRIAL_REQUEST_RATE_LIMITED: {
    status: 429,
    code: "TRIAL_REQUEST_RATE_LIMITED",
    message: "Too many trial requests from this network. Please try again later.",
  },
  TRIAL_REAPPLY_TOO_SOON: {
    status: 409,
    code: "TRIAL_REAPPLY_TOO_SOON",
    message:
      "Your previous request was reviewed recently. Please contact support if you would like it reconsidered.",
  },
  TRIAL_REQUEST_NOT_FOUND: {
    status: 404,
    code: "TRIAL_REQUEST_NOT_FOUND",
    message: "Trial request was not found.",
  },
  TRIAL_REQUEST_NOT_DECIDABLE: {
    status: 409,
    code: "TRIAL_REQUEST_NOT_DECIDABLE",
    message: "This trial request can no longer be decided.",
  },
  TRIAL_REQUEST_ALREADY_APPROVED: {
    status: 409,
    code: "TRIAL_REQUEST_ALREADY_APPROVED",
    message: "This trial request was already approved and cannot be rejected here.",
  },
  ORGANIZATION_REQUIRED: {
    status: 400,
    code: "INVALID_ORGANIZATION_ID",
    message: "Invalid recruiter workspace.",
  },
}

function translateDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : ""

  for (const [key, mapped] of Object.entries(DB_ERROR_MAP)) {
    if (message.includes(key)) {
      throw new ApiError(mapped.status, mapped.code, mapped.message)
    }
  }

  console.error("Trial request operation failed", error)
  throw new ApiError(503, "TRIAL_REQUEST_FAILED", "Unable to process the trial request. Please try again.")
}

function toIsoOrNull(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toCount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function mapRecruiterState(organizationId: string, raw: Record<string, unknown> | null): RecruiterTrialState {
  const state = raw ?? {}

  return {
    organizationId,
    status: (String(state.status ?? "NOT_REQUESTED") as TrialRequestStatus),
    requestId: state.requestId ? String(state.requestId) : null,
    requestedAt: toIsoOrNull(state.requestedAt),
    decidedAt: toIsoOrNull(state.decidedAt),
    decisionReason: state.decisionReason ? String(state.decisionReason) : null,
    granted: Boolean(state.granted),
    grantedAt: toIsoOrNull(state.grantedAt),
    expiresAt: toIsoOrNull(state.expiresAt),
    interviewCreditsRemaining: toCount(state.interviewCreditsRemaining),
    screeningCreditsRemaining: toCount(state.screeningCreditsRemaining),
    offer: {
      aiInterviews: RECRUITER_TRIAL_AI_INTERVIEWS,
      verisScreenings: RECRUITER_TRIAL_VERIS_SCREENINGS,
    },
  }
}

export async function getRecruiterTrialState(organizationId: string): Promise<RecruiterTrialState> {
  if (!UUID_REGEX.test(organizationId)) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "Invalid recruiter workspace.")
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ state: Record<string, unknown> }>>(Prisma.sql`
      select public.fn_get_recruiter_trial_state(${organizationId}::uuid) as state
    `)

    return mapRecruiterState(organizationId, rows[0]?.state ?? null)
  } catch (error) {
    // The entitlement migration may not be applied on this environment yet.
    // Report "not requested" rather than breaking the dashboard.
    console.warn("Recruiter trial state read failed", error)
    return mapRecruiterState(organizationId, null)
  }
}

export async function requestRecruiterTrial(input: {
  organizationId: string
  userId: string
  email: string
  emailVerified: boolean
  companyName: string | null
  companyWebsite: string | null
  origin?: TrialRequestOrigin
}): Promise<RecruiterTrialState> {
  if (!UUID_REGEX.test(input.organizationId)) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "Invalid recruiter workspace.")
  }

  try {
    // Everything (validation, risk scoring, request creation and — when the
    // company validates cleanly — the grant itself) happens inside this one
    // database call, so retries and concurrent submits cannot double-grant.
    await prisma.$queryRaw(Prisma.sql`
      select *
      from public.fn_request_recruiter_trial(
        ${input.organizationId}::uuid,
        ${input.userId}::uuid,
        ${input.email}::text,
        ${input.emailVerified}::boolean,
        ${input.companyName}::text,
        ${input.companyWebsite}::text,
        ${input.origin?.ip ?? null}::text,
        ${input.origin?.userAgent ?? null}::text,
        ${input.origin?.deviceHash ?? null}::text
      )
    `)
  } catch (error) {
    translateDatabaseError(error)
  }

  return getRecruiterTrialState(input.organizationId)
}

// ---------------------------------------------------------------------------
// Admin review
// ---------------------------------------------------------------------------

export type AdminTrialRequestRow = {
  requestId: string
  requestType: "RECRUITER_TRIAL" | "CANDIDATE_PRACTICE"
  status: TrialRequestStatus
  organizationId: string | null
  organizationName: string | null
  identityId: string | null
  contactEmail: string | null
  emailDomain: string | null
  emailVerified: boolean
  companyName: string | null
  companyWebsite: string | null
  riskScore: number
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  riskReasons: string[]
  validation: Record<string, unknown>
  requestedAt: string | null
  decidedAt: string | null
  decidedBy: string | null
  decisionReason: string | null
  autoDecision: boolean
  granted: boolean
}

type AdminTrialRequestDbRow = {
  request_id: string
  request_type: string
  status: string
  organization_id: string | null
  organization_name: string | null
  identity_id: string | null
  contact_email: string | null
  email_domain: string | null
  email_verified: boolean
  company_name: string | null
  company_website: string | null
  risk_score: number
  risk_level: string
  risk_reasons: string[] | null
  validation: Record<string, unknown> | null
  created_at: Date | string | null
  decided_at: Date | string | null
  decided_by: string | null
  decision_reason: string | null
  auto_decision: boolean
  granted: boolean
}

function mapAdminRow(row: AdminTrialRequestDbRow): AdminTrialRequestRow {
  return {
    requestId: row.request_id,
    requestType: row.request_type as AdminTrialRequestRow["requestType"],
    status: row.status as TrialRequestStatus,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    identityId: row.identity_id,
    contactEmail: row.contact_email,
    emailDomain: row.email_domain,
    emailVerified: Boolean(row.email_verified),
    companyName: row.company_name,
    companyWebsite: row.company_website,
    riskScore: Number(row.risk_score ?? 0),
    riskLevel: (row.risk_level as AdminTrialRequestRow["riskLevel"]) ?? "LOW",
    riskReasons: row.risk_reasons ?? [],
    validation: row.validation ?? {},
    requestedAt: toIsoOrNull(row.created_at),
    decidedAt: toIsoOrNull(row.decided_at),
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    autoDecision: Boolean(row.auto_decision),
    granted: Boolean(row.granted),
  }
}

export async function listTrialRequestsForAdmin(input: {
  status?: TrialRequestStatus | "ALL"
  requestType?: "RECRUITER_TRIAL" | "CANDIDATE_PRACTICE" | "ALL"
  limit?: number
}): Promise<AdminTrialRequestRow[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 100)))
  const status = input.status && input.status !== "ALL" ? input.status : null
  const requestType = input.requestType && input.requestType !== "ALL" ? input.requestType : null

  try {
    const rows = await prisma.$queryRaw<AdminTrialRequestDbRow[]>(Prisma.sql`
      select
        r.request_id::text,
        r.request_type,
        r.status,
        r.organization_id::text,
        o.organization_name,
        r.identity_id::text,
        r.contact_email,
        r.email_domain,
        r.email_verified,
        r.company_name,
        r.company_website,
        r.risk_score,
        r.risk_level,
        r.risk_reasons,
        r.validation,
        r.created_at,
        r.decided_at,
        r.decided_by,
        r.decision_reason,
        r.auto_decision,
        exists (select 1 from public.trial_grants g where g.request_id = r.request_id) as granted
      from public.trial_requests r
      left join public.organizations o on o.organization_id = r.organization_id
      where (${status}::text is null or r.status = ${status}::text)
        and (${requestType}::text is null or r.request_type = ${requestType}::text)
      order by
        case r.status when 'PENDING_REVIEW' then 0 else 1 end,
        r.created_at desc
      limit ${limit}
    `)

    return rows.map(mapAdminRow)
  } catch (error) {
    console.error("Trial request admin listing failed", error)
    throw new ApiError(503, "TRIAL_REQUESTS_UNAVAILABLE", "Unable to load trial requests.")
  }
}

export async function getTrialRequestForAdmin(requestId: string): Promise<AdminTrialRequestRow | null> {
  if (!UUID_REGEX.test(requestId)) {
    return null
  }

  const rows = await listTrialRequestsByIds([requestId])
  return rows[0] ?? null
}

async function listTrialRequestsByIds(requestIds: string[]) {
  if (requestIds.length === 0) return []

  const rows = await prisma.$queryRaw<AdminTrialRequestDbRow[]>(Prisma.sql`
    select
      r.request_id::text,
      r.request_type,
      r.status,
      r.organization_id::text,
      o.organization_name,
      r.identity_id::text,
      r.contact_email,
      r.email_domain,
      r.email_verified,
      r.company_name,
      r.company_website,
      r.risk_score,
      r.risk_level,
      r.risk_reasons,
      r.validation,
      r.created_at,
      r.decided_at,
      r.decided_by,
      r.decision_reason,
      r.auto_decision,
      exists (select 1 from public.trial_grants g where g.request_id = r.request_id) as granted
    from public.trial_requests r
    left join public.organizations o on o.organization_id = r.organization_id
    where r.request_id = any(${requestIds}::uuid[])
  `)

  return rows.map(mapAdminRow)
}

export type TrialDecisionResult = {
  requestId: string
  status: TrialRequestStatus
  /** true only when this specific call issued the credits. */
  granted: boolean
}

export async function approveTrialRequest(input: {
  requestId: string
  actor: string
  reason?: string | null
}): Promise<TrialDecisionResult> {
  if (!UUID_REGEX.test(input.requestId)) {
    throw new ApiError(400, "INVALID_REQUEST_ID", "Invalid trial request.")
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ request_id: string; status: string; granted: boolean }>>(
      Prisma.sql`
        select request_id::text, status, granted
        from public.fn_approve_trial_request(
          ${input.requestId}::uuid,
          ${input.actor}::text,
          ${input.reason ?? null}::text
        )
      `
    )

    const row = rows[0]
    if (!row) {
      throw new ApiError(404, "TRIAL_REQUEST_NOT_FOUND", "Trial request was not found.")
    }

    return {
      requestId: row.request_id,
      status: row.status as TrialRequestStatus,
      granted: Boolean(row.granted),
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    translateDatabaseError(error)
  }
}

export async function rejectTrialRequest(input: {
  requestId: string
  actor: string
  reason?: string | null
}): Promise<TrialDecisionResult> {
  if (!UUID_REGEX.test(input.requestId)) {
    throw new ApiError(400, "INVALID_REQUEST_ID", "Invalid trial request.")
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ request_id: string; status: string }>>(Prisma.sql`
      select request_id::text, status
      from public.fn_reject_trial_request(
        ${input.requestId}::uuid,
        ${input.actor}::text,
        ${input.reason ?? null}::text
      )
    `)

    const row = rows[0]
    if (!row) {
      throw new ApiError(404, "TRIAL_REQUEST_NOT_FOUND", "Trial request was not found.")
    }

    return {
      requestId: row.request_id,
      status: row.status as TrialRequestStatus,
      granted: false,
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    translateDatabaseError(error)
  }
}
