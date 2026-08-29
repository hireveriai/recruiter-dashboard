import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"

export type DashboardAlert = {
  id: string
  type:
    | "INTERVIEW_STARTED"
    | "INTERVIEW_COMPLETED"
    | "INTERVIEW_NEEDS_REVIEW"
    | "INTERVIEW_INTERRUPTED"
    | "INTERVIEW_FAILED"
  title: string
  message: string
  tone: "info" | "success" | "warning" | "danger"
  candidateName: string
  jobTitle: string
  occurredAt: string
}

type AlertRow = {
  alert_id: string
  alert_type: DashboardAlert["type"]
  candidate_name: string | null
  job_title: string | null
  attempt_status: string | null
  interview_status: string | null
  started_at: Date | string | null
  ended_at: Date | string | null
  occurred_at: Date | string | null
}

let ensureAlertReadsPromise: Promise<void> | null = null
let alertReadsTableExistsCache: boolean | null = null

async function ensureDashboardAlertReadsTable() {
  if (!ensureAlertReadsPromise) {
    ensureAlertReadsPromise = (async () => {
      await prisma.$executeRaw(Prisma.sql`
        create table if not exists public.dashboard_alert_reads (
          organization_id uuid not null,
          user_id uuid not null,
          alert_id text not null,
          read_at timestamptz not null default now(),
          constraint dashboard_alert_reads_org_user_alert_unique unique (organization_id, user_id, alert_id)
        )
      `)

      await prisma.$executeRaw(Prisma.sql`
        delete from public.dashboard_alert_reads a
        using public.dashboard_alert_reads b
        where a.organization_id = b.organization_id
          and a.user_id = b.user_id
          and a.alert_id = b.alert_id
          and a.ctid < b.ctid
      `)

      await prisma.$executeRaw(Prisma.sql`
        create unique index if not exists dashboard_alert_reads_org_user_alert_unique_idx
          on public.dashboard_alert_reads (organization_id, user_id, alert_id)
      `)

      await prisma.$executeRaw(Prisma.sql`
        create index if not exists dashboard_alert_reads_org_user_idx
          on public.dashboard_alert_reads (organization_id, user_id, read_at desc)
      `)

      await prisma.$executeRaw(Prisma.sql`
        create index if not exists dashboard_alert_reads_alert_idx
          on public.dashboard_alert_reads (alert_id)
      `)

      alertReadsTableExistsCache = true
    })().catch((error) => {
      ensureAlertReadsPromise = null
      throw error
    })
  }

  return ensureAlertReadsPromise
}

async function dashboardAlertReadsTableExists() {
  if (alertReadsTableExistsCache !== null) {
    return alertReadsTableExistsCache
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ regclass: string | null }>>(Prisma.sql`
      select to_regclass('public.dashboard_alert_reads')::text as regclass
    `)
    alertReadsTableExistsCache = Boolean(rows[0]?.regclass)
  } catch (error) {
    console.warn("Dashboard alert read table lookup failed", error)
    alertReadsTableExistsCache = false
  }

  return alertReadsTableExistsCache
}

function normalizeStatus(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase()
}

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return new Date().toISOString()
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function buildAlert(row: AlertRow): DashboardAlert {
  const candidateName = row.candidate_name || "Candidate"
  const jobTitle = row.job_title || "Interview"
  const type = row.alert_type

  if (type === "INTERVIEW_COMPLETED") {
    return {
      id: row.alert_id,
      type,
      title: "Interview completed",
      message: `${candidateName} completed ${jobTitle}. Review the report when ready.`,
      tone: "success",
      candidateName,
      jobTitle,
      occurredAt: toIso(row.occurred_at),
    }
  }

  if (type === "INTERVIEW_NEEDS_REVIEW") {
    return {
      id: row.alert_id,
      type,
      title: "Interview needs review",
      message: `${candidateName}'s ${jobTitle} session did not complete cleanly. Any score shown is partial — check the session before deciding.`,
      tone: "warning",
      candidateName,
      jobTitle,
      occurredAt: toIso(row.occurred_at),
    }
  }

  if (type === "INTERVIEW_INTERRUPTED") {
    return {
      id: row.alert_id,
      type,
      title: "Interview interrupted",
      message: `${candidateName} has an interrupted interview. Check recovery and evidence logs.`,
      tone: "warning",
      candidateName,
      jobTitle,
      occurredAt: toIso(row.occurred_at),
    }
  }

  if (type === "INTERVIEW_FAILED") {
    return {
      id: row.alert_id,
      type,
      title: "Interview needs attention",
      message: `${candidateName}'s interview workflow reported a failure state.`,
      tone: "danger",
      candidateName,
      jobTitle,
      occurredAt: toIso(row.occurred_at),
    }
  }

  return {
    id: row.alert_id,
    type: "INTERVIEW_STARTED",
    title: "Interview started",
    message: `${candidateName} started ${jobTitle}. Live interview telemetry is active.`,
    tone: "info",
    candidateName,
    jobTitle,
    occurredAt: toIso(row.occurred_at),
  }
}

export async function getDashboardAlerts(organizationId: string, limit?: number | "all", userId?: string): Promise<DashboardAlert[]> {
  const canFilterReadAlerts = Boolean(userId) && await dashboardAlertReadsTableExists()
  const limitClause =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Prisma.sql`limit ${Math.floor(limit)}`
      : Prisma.empty

  const rows = await prisma.$queryRaw<AlertRow[]>(Prisma.sql`
    with latest_attempts as (
      select distinct on (ia.interview_id)
        ia.attempt_id,
        ia.interview_id,
        ia.status as attempt_status,
        ia.started_at,
        ia.ended_at,
        ia.interruption_reason
      from public.interview_attempts ia
      inner join public.interviews attempt_interview
        on attempt_interview.interview_id = ia.interview_id
        and attempt_interview.organization_id = ${organizationId}::uuid
      order by ia.interview_id, ia.started_at desc
    ),
    alert_source as (
      select
        i.interview_id::text || ':' || coalesce(la.attempt_id::text, i.status, 'pending') as alert_id,
        case
          when upper(coalesce(la.attempt_status, i.status, '')) in ('INTERRUPTED', 'RECOVERY_ALLOWED') then 'INTERVIEW_INTERRUPTED'
          when upper(coalesce(i.status, la.attempt_status, '')) in ('FAILED', 'PREPARATION_FAILED') then 'INTERVIEW_FAILED'
          -- Ahead of the completion arm: that arm treats any attempt with an
          -- ended_at as completed, which is true of abandoned attempts too, so
          -- a dropped session raised a success-toned "interview completed"
          -- alert on the recruiter's feed.
          when upper(coalesce(i.status, '')) = 'NEEDS_REVIEW'
            or upper(coalesce(i.final_status, '')) = 'TRANSCRIPT_REVIEW_REQUIRED'
            or upper(coalesce(la.attempt_status, '')) in ('ABANDONED', 'TIME_EXPIRED')
            then 'INTERVIEW_NEEDS_REVIEW'
          when upper(coalesce(i.status, la.attempt_status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED') or la.ended_at is not null then 'INTERVIEW_COMPLETED'
          when la.started_at is not null then 'INTERVIEW_STARTED'
          else null
        end as alert_type,
        c.full_name as candidate_name,
        jp.job_title,
        la.attempt_status,
        i.status as interview_status,
        la.started_at,
        la.ended_at,
        coalesce(la.ended_at, la.started_at, i.created_at) as occurred_at
      from public.interviews i
      left join latest_attempts la on la.interview_id = i.interview_id
      left join public.candidates c on c.candidate_id = i.candidate_id
      left join public.job_positions jp on jp.job_id = i.job_id
      where i.organization_id = ${organizationId}::uuid
    )
    select *
    from alert_source
    where alert_type is not null
      ${canFilterReadAlerts
        ? Prisma.sql`and not exists (
          select 1
          from public.dashboard_alert_reads dar
          where dar.organization_id = ${organizationId}::uuid
            and dar.user_id = ${userId}::uuid
            and dar.alert_id = alert_source.alert_id
        )`
        : Prisma.empty}
    order by occurred_at desc nulls last
    ${limitClause}
  `)

  return rows
    .filter((row) => Boolean(row.alert_type))
    .map((row) => ({
      ...row,
      alert_type: normalizeStatus(row.alert_type) as DashboardAlert["type"],
    }))
    .map(buildAlert)
}

export async function markDashboardAlertsRead(input: {
  organizationId: string
  userId: string
  alertIds: string[]
}) {
  const alertIds = Array.from(new Set(input.alertIds.map((id) => id.trim()).filter(Boolean)))

  if (alertIds.length === 0) {
    return { marked: 0 }
  }

  await ensureDashboardAlertReadsTable()

  const rows = await prisma.$queryRaw<Array<{ marked: bigint }>>(Prisma.sql`
    with inserted as (
      insert into public.dashboard_alert_reads (
        organization_id,
        user_id,
        alert_id,
        read_at
      )
      select
        ${input.organizationId}::uuid,
        ${input.userId}::uuid,
        alert_id,
        now()
      from unnest(array[${Prisma.join(alertIds)}]::text[]) as alert_id
      on conflict (organization_id, user_id, alert_id) do update
        set read_at = excluded.read_at
      returning 1
    )
    select count(*)::bigint as marked
    from inserted
  `)

  return { marked: Number(rows[0]?.marked ?? 0) }
}
