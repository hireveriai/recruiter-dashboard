import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

export const FREE_TRIAL_INTERVIEW_CREDITS = 5
export const FREE_TRIAL_SCREENING_CREDITS = 15
export const FREE_TRIAL_LIMIT_MESSAGE =
  "You’ve reached your free trial limit. Upgrade your workspace to continue conducting interviews and screenings."

export type TrialCreditKind = "INTERVIEW" | "SCREENING"
export type CreditBalanceSource = "trial" | "subscription"

export type TrialCreditSnapshot = {
  organizationId: string
  interviewCreditsRemaining: number
  screeningCreditsRemaining: number
  canSendInterview: boolean
  canStartScreening: boolean
  upgradeMessage: string
  source: CreditBalanceSource
  subscriptionId?: string | null
  planId?: string | null
  subscriptionStatus?: string | null
  subscriptionExpiresAt?: string | null
}

type TrialCreditRow = {
  organization_id: string
  interview_credits_remaining: number
  screening_credits_remaining: number
}

type SubscriptionCreditRow = {
  id: string
  organization_id: string
  plan_id: string | null
  status: string | null
  interview_credits_remaining: number
  screening_credits_remaining: number
  expires_at: Date | string | null
}

type QueryClient = typeof prisma | Prisma.TransactionClient
type TrialCreditCacheEntry = {
  value: TrialCreditSnapshot
  expiresAt: number
}

type RefundableInviteRow = {
  invite_id: string
  interview_id: string
  organization_id: string
  status: string | null
  expires_at: Date | string | null
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TRIAL_CREDIT_DASHBOARD_CACHE_TTL_MS = 0
const INTERVIEW_REFUND_EVENT_SOURCE = "unused_interview_refund"
const trialCreditDashboardCache = new Map<string, TrialCreditCacheEntry>()
let ensureTrialCreditSchemaPromise: Promise<void> | null = null

function invalidateTrialCreditDashboardCache(organizationId: string) {
  trialCreditDashboardCache.delete(organizationId)
}

function normalizeCount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function mapTrialCreditRow(row: TrialCreditRow): TrialCreditSnapshot {
  const interviewCreditsRemaining = normalizeCount(row.interview_credits_remaining)
  const screeningCreditsRemaining = normalizeCount(row.screening_credits_remaining)

  return {
    organizationId: row.organization_id,
    interviewCreditsRemaining,
    screeningCreditsRemaining,
    canSendInterview: interviewCreditsRemaining > 0,
    canStartScreening: screeningCreditsRemaining > 0,
    upgradeMessage: FREE_TRIAL_LIMIT_MESSAGE,
    source: "trial",
  }
}

function mapSubscriptionCreditRow(row: SubscriptionCreditRow): TrialCreditSnapshot {
  const interviewCreditsRemaining = normalizeCount(row.interview_credits_remaining)
  const screeningCreditsRemaining = normalizeCount(row.screening_credits_remaining)

  return {
    organizationId: row.organization_id,
    interviewCreditsRemaining,
    screeningCreditsRemaining,
    canSendInterview: interviewCreditsRemaining > 0,
    canStartScreening: screeningCreditsRemaining > 0,
    upgradeMessage: "",
    source: "subscription",
    subscriptionId: row.id,
    planId: row.plan_id,
    subscriptionStatus: row.status,
    subscriptionExpiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  }
}

export function createInitialTrialCreditSnapshot(organizationId: string): TrialCreditSnapshot {
  return {
    organizationId,
    interviewCreditsRemaining: FREE_TRIAL_INTERVIEW_CREDITS,
    screeningCreditsRemaining: FREE_TRIAL_SCREENING_CREDITS,
    canSendInterview: true,
    canStartScreening: true,
    upgradeMessage: FREE_TRIAL_LIMIT_MESSAGE,
    source: "trial",
  }
}

export async function ensureTrialCreditSchema(client: QueryClient = prisma) {
  if (client === prisma && ensureTrialCreditSchemaPromise) {
    return ensureTrialCreditSchemaPromise
  }

  const ensurePromise = (async () => {
    await client.$executeRaw(Prisma.sql`
    create table if not exists public.workspace_trial_credits (
      organization_id uuid primary key references public.organizations(organization_id) on delete cascade,
      interview_credits_remaining integer not null default ${FREE_TRIAL_INTERVIEW_CREDITS},
      screening_credits_remaining integer not null default ${FREE_TRIAL_SCREENING_CREDITS},
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint workspace_trial_credits_interview_non_negative check (interview_credits_remaining >= 0),
      constraint workspace_trial_credits_screening_non_negative check (screening_credits_remaining >= 0)
    )
  `)

    await client.$executeRaw(Prisma.sql`
    alter table public.workspace_trial_credits
      add column if not exists interview_credits_remaining integer not null default ${FREE_TRIAL_INTERVIEW_CREDITS},
      add column if not exists screening_credits_remaining integer not null default ${FREE_TRIAL_SCREENING_CREDITS},
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now()
  `)

    await client.$executeRaw(Prisma.sql`
      create index if not exists workspace_trial_credits_updated_at_idx
        on public.workspace_trial_credits (updated_at desc)
    `).catch((error) => {
      console.warn("Trial credit balance index setup skipped", error)
    })

    await ensureTrialCreditOptionalSchema(client)
  })()

  if (client !== prisma) {
    return ensurePromise
  }

  ensureTrialCreditSchemaPromise = ensurePromise.catch((error) => {
    ensureTrialCreditSchemaPromise = null
    throw error
  })

  return ensureTrialCreditSchemaPromise
}

async function ensureTrialCreditOptionalSchema(client: QueryClient = prisma) {
  await client.$executeRawUnsafe(`
  create or replace function public.ensure_workspace_trial_credits()
  returns trigger
  language plpgsql
  as $$
  begin
    insert into public.workspace_trial_credits (
      organization_id,
      interview_credits_remaining,
      screening_credits_remaining
    )
    values (
      new.organization_id,
      ${FREE_TRIAL_INTERVIEW_CREDITS},
      ${FREE_TRIAL_SCREENING_CREDITS}
    )
    on conflict (organization_id) do nothing;

    return new;
  end;
  $$;
`).catch((error) => {
    console.warn("Trial credit organization trigger function setup skipped", error)
  })

  await client.$executeRawUnsafe(`
  drop trigger if exists organizations_seed_workspace_trial_credits on public.organizations;
  create trigger organizations_seed_workspace_trial_credits
    after insert on public.organizations
    for each row
    execute function public.ensure_workspace_trial_credits();
`).catch((error) => {
    console.warn("Trial credit organization trigger setup skipped", error)
  })

  await client.$executeRaw(Prisma.sql`
  create table if not exists public.workspace_trial_credit_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(organization_id) on delete cascade,
    kind text not null,
    amount integer not null,
    source text,
    source_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint workspace_trial_credit_events_kind_check check (kind in ('INTERVIEW', 'SCREENING')),
    constraint workspace_trial_credit_events_amount_positive check (amount > 0)
  )
`).catch((error) => {
    console.warn("Trial credit audit table setup skipped", error)
  })

  await client.$executeRaw(Prisma.sql`
    create index if not exists workspace_trial_credit_events_org_kind_created_idx
      on public.workspace_trial_credit_events (organization_id, kind, created_at desc)
  `).catch((error) => {
    console.warn("Trial credit audit index setup skipped", error)
  })

  await client.$executeRaw(Prisma.sql`
    create unique index if not exists workspace_trial_credit_events_source_uidx
      on public.workspace_trial_credit_events (organization_id, kind, source, source_id)
      where source_id is not null
  `).catch((error) => {
    console.warn("Trial credit audit unique index setup skipped", error)
  })
}

export async function ensureTrialCreditOrganization(organizationId: string, client: QueryClient = prisma) {
  if (!UUID_REGEX.test(organizationId)) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "Invalid recruiter workspace.")
  }

  try {
    await client.$executeRaw(Prisma.sql`
      insert into public.organizations (
        organization_id,
        organization_name,
        is_active,
        created_at
      )
      values (
        ${organizationId}::uuid,
        'Recruiter Workspace',
        true,
        now()
      )
      on conflict (organization_id) do nothing
    `)
  } catch (error) {
    console.warn("Trial credit organization bootstrap skipped", error)
  }

  const rows = await client.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    select exists (
      select 1
      from public.organizations
      where organization_id = ${organizationId}::uuid
    ) as exists
  `)

  if (!rows[0]?.exists) {
    throw new ApiError(404, "RECRUITER_WORKSPACE_NOT_FOUND", "Recruiter workspace was not found.")
  }
}

export async function getOrCreateTrialCredits(organizationId: string, client: QueryClient = prisma) {
  await ensureTrialCreditOrganization(organizationId, client)
  if (client === prisma) {
    await refundExpiredUnusedInterviewCredits({ organizationId }).catch((error) => {
      console.warn("Unused interview credit refund reconciliation skipped", error)
    })
  }

  const subscriptionCredits = await getActiveSubscriptionCredits(organizationId, client)
  if (subscriptionCredits) {
    return subscriptionCredits
  }

  let rows = await upsertTrialCreditRow(organizationId, client).catch(async (error) => {
    console.warn("Trial credit balance table read failed; attempting schema setup", error)
    await ensureTrialCreditSchema(client)
    return upsertTrialCreditRow(organizationId, client)
  })

  const row = rows[0]
  if (!row) {
    throw new ApiError(500, "TRIAL_CREDITS_UNAVAILABLE", "Unable to load free trial credits.")
  }

  return mapTrialCreditRow(row)
}

async function getActiveSubscriptionCredits(organizationId: string, client: QueryClient = prisma) {
  const rows = await client.$queryRaw<SubscriptionCreditRow[]>(Prisma.sql`
    select
      id,
      "organizationId"::text as organization_id,
      "planId" as plan_id,
      status,
      "totalCredits" as interview_credits_remaining,
      "screeningCredits" as screening_credits_remaining,
      "expiresAt" as expires_at
    from public.hireveri_user_subscriptions
    where "organizationId" = ${organizationId}::uuid
      and lower(coalesce(status, '')) = 'active'
      and ("expiresAt" is null or "expiresAt" > now())
    order by "activatedAt" desc nulls last, "updatedAt" desc nulls last
    limit 1
  `).catch((error) => {
    console.warn("Subscription credit read skipped", error)
    return [] as SubscriptionCreditRow[]
  })

  const row = rows[0]
  return row ? mapSubscriptionCreditRow(row) : null
}

async function upsertTrialCreditRow(organizationId: string, client: QueryClient = prisma) {
  const insertedRows = await client.$queryRaw<TrialCreditRow[]>(Prisma.sql`
    insert into public.workspace_trial_credits (
      organization_id,
      interview_credits_remaining,
      screening_credits_remaining
    )
    values (
      ${organizationId}::uuid,
      ${FREE_TRIAL_INTERVIEW_CREDITS},
      ${FREE_TRIAL_SCREENING_CREDITS}
    )
    on conflict (organization_id) do nothing
    returning
      organization_id::text,
      interview_credits_remaining,
      screening_credits_remaining
  `)

  return insertedRows.length > 0
    ? insertedRows
    : await client.$queryRaw<TrialCreditRow[]>(Prisma.sql`
      select
        organization_id::text,
        interview_credits_remaining,
        screening_credits_remaining
      from public.workspace_trial_credits
      where organization_id = ${organizationId}::uuid
      limit 1
    `)
}

async function deductSubscriptionCredits(input: {
  organizationId: string
  kind: TrialCreditKind
  amount: number
  subscriptionId: string
}) {
  const rows = input.kind === "INTERVIEW"
    ? await prisma.$queryRaw<SubscriptionCreditRow[]>(Prisma.sql`
      update public.hireveri_user_subscriptions
      set
        "totalCredits" = "totalCredits" - ${input.amount},
        "usedCredits" = coalesce("usedCredits", 0) + ${input.amount},
        "updatedAt" = now()
      where id = ${input.subscriptionId}
        and "organizationId" = ${input.organizationId}::uuid
        and lower(coalesce(status, '')) = 'active'
        and ("expiresAt" is null or "expiresAt" > now())
        and "totalCredits" >= ${input.amount}
      returning
        id,
        "organizationId"::text as organization_id,
        "planId" as plan_id,
        status,
        "totalCredits" as interview_credits_remaining,
        "screeningCredits" as screening_credits_remaining,
        "expiresAt" as expires_at
    `)
    : await prisma.$queryRaw<SubscriptionCreditRow[]>(Prisma.sql`
      update public.hireveri_user_subscriptions
      set
        "screeningCredits" = "screeningCredits" - ${input.amount},
        "updatedAt" = now()
      where id = ${input.subscriptionId}
        and "organizationId" = ${input.organizationId}::uuid
        and lower(coalesce(status, '')) = 'active'
        and ("expiresAt" is null or "expiresAt" > now())
        and "screeningCredits" >= ${input.amount}
      returning
        id,
        "organizationId"::text as organization_id,
        "planId" as plan_id,
        status,
        "totalCredits" as interview_credits_remaining,
        "screeningCredits" as screening_credits_remaining,
        "expiresAt" as expires_at
    `)

  const row = rows[0]
  if (!row) {
    throw new ApiError(402, "SUBSCRIPTION_CREDITS_EXHAUSTED", "Your subscription does not have enough credits for this action.")
  }

  invalidateTrialCreditDashboardCache(input.organizationId)
  return mapSubscriptionCreditRow(row)
}

async function getRefundableInviteRows(organizationId: string, inviteIds?: string[]) {
  const inviteFilter =
    inviteIds && inviteIds.length > 0
      ? Prisma.sql`and ii.invite_id = any(${inviteIds}::uuid[])`
      : Prisma.empty

  return prisma.$queryRaw<RefundableInviteRow[]>(Prisma.sql`
    select
      ii.invite_id::text,
      ii.interview_id::text,
      i.organization_id::text,
      ii.status,
      ii.expires_at
    from public.interview_invites ii
    inner join public.interviews i
      on i.interview_id = ii.interview_id
    where i.organization_id = ${organizationId}::uuid
      ${inviteFilter}
      and coalesce(upper(ii.access_type), '') <> 'RECOVERY'
      and ii.used_at is null
      and (
        upper(coalesce(ii.status, 'ACTIVE')) in ('EXPIRED', 'REVOKED')
        or ii.expires_at <= now()
      )
      and not exists (
        select 1
        from public.workspace_trial_credit_events evt
        where evt.organization_id = i.organization_id
          and evt.kind = 'INTERVIEW'
          and evt.source = ${INTERVIEW_REFUND_EVENT_SOURCE}
          and evt.source_id = ii.invite_id::text
      )
    order by ii.expires_at asc nulls last, ii.created_at asc
    limit 250
  `)
}

async function insertRefundEvent(input: {
  organizationId: string
  invite: RefundableInviteRow
}) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    insert into public.workspace_trial_credit_events (
      organization_id,
      kind,
      amount,
      source,
      source_id,
      metadata
    )
    values (
      ${input.organizationId}::uuid,
      'INTERVIEW',
      1,
      ${INTERVIEW_REFUND_EVENT_SOURCE},
      ${input.invite.invite_id},
      ${JSON.stringify({
        refund: true,
        reason: "unused_interview_link_expired_or_revoked",
        inviteId: input.invite.invite_id,
        interviewId: input.invite.interview_id,
        inviteStatus: input.invite.status,
        expiresAt: input.invite.expires_at
          ? new Date(input.invite.expires_at).toISOString()
          : null,
      })}::jsonb
    )
    on conflict do nothing
    returning id::text
  `)

  return rows.length > 0
}

async function refundOneInterviewCredit(input: {
  organizationId: string
  invite: RefundableInviteRow
}) {
  const trialDeductionEvents = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    select id::text
    from public.workspace_trial_credit_events
    where organization_id = ${input.organizationId}::uuid
      and kind = 'INTERVIEW'
      and source = 'interview_link'
      and source_id = ${input.invite.interview_id}
    limit 1
  `)

  if (trialDeductionEvents.length > 0) {
    await upsertTrialCreditRow(input.organizationId)
    await prisma.$executeRaw(Prisma.sql`
      update public.workspace_trial_credits
      set
        interview_credits_remaining = interview_credits_remaining + 1,
        updated_at = now()
      where organization_id = ${input.organizationId}::uuid
    `)
    return
  }

  const activeSubscription = await getActiveSubscriptionCredits(input.organizationId)

  if (activeSubscription?.subscriptionId) {
    await prisma.$executeRaw(Prisma.sql`
      update public.hireveri_user_subscriptions
      set
        "totalCredits" = "totalCredits" + 1,
        "usedCredits" = greatest(coalesce("usedCredits", 0) - 1, 0),
        "updatedAt" = now()
      where id = ${activeSubscription.subscriptionId}
        and "organizationId" = ${input.organizationId}::uuid
    `)
    return
  }

  await upsertTrialCreditRow(input.organizationId)
  await prisma.$executeRaw(Prisma.sql`
    update public.workspace_trial_credits
    set
      interview_credits_remaining = interview_credits_remaining + 1,
      updated_at = now()
    where organization_id = ${input.organizationId}::uuid
  `)
}

export async function refundExpiredUnusedInterviewCredits(input: {
  organizationId: string
  inviteIds?: string[]
}) {
  if (!UUID_REGEX.test(input.organizationId)) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "Invalid recruiter workspace.")
  }

  await ensureTrialCreditSchema()

  const invites = await getRefundableInviteRows(input.organizationId, input.inviteIds)
  let refunded = 0

  for (const invite of invites) {
    const eventInserted = await insertRefundEvent({
      organizationId: input.organizationId,
      invite,
    })

    if (!eventInserted) {
      continue
    }

    await refundOneInterviewCredit({
      organizationId: input.organizationId,
      invite,
    })
    refunded += 1
  }

  if (refunded > 0) {
    invalidateTrialCreditDashboardCache(input.organizationId)
  }

  return { refunded }
}

export async function getTrialCreditsDashboardSnapshot(organizationId: string, client: QueryClient = prisma) {
  const cached = client === prisma ? trialCreditDashboardCache.get(organizationId) : null
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const snapshot = await getOrCreateTrialCredits(organizationId, client)

  if (client === prisma) {
    trialCreditDashboardCache.set(organizationId, {
      value: snapshot,
      expiresAt: Date.now() + TRIAL_CREDIT_DASHBOARD_CACHE_TTL_MS,
    })
  }

  return snapshot
}

export async function assertTrialCreditsAvailable(input: {
  organizationId: string
  kind: TrialCreditKind
  amount?: number
}) {
  const amount = Math.max(1, Math.floor(input.amount ?? 1))
  const credits = await getOrCreateTrialCredits(input.organizationId).catch((error) => {
    console.error("Trial credit availability check failed", error)
    throw new ApiError(503, "TRIAL_CREDITS_UNAVAILABLE", "Unable to verify free trial credits. Please try again.")
  })

  const remaining =
    input.kind === "INTERVIEW" ? credits.interviewCreditsRemaining : credits.screeningCreditsRemaining

  if (remaining < amount) {
    const label = input.kind === "INTERVIEW" ? "interview" : "screening"
    throw new ApiError(
      402,
      "FREE_TRIAL_LIMIT_REACHED",
      remaining <= 0
        ? FREE_TRIAL_LIMIT_MESSAGE
        : `This action needs ${amount} ${label} credit${amount === 1 ? "" : "s"}, but your workspace has ${remaining} left. Reduce the selection or upgrade your workspace.`
    )
  }

  return credits
}

export async function deductTrialCredits(input: {
  organizationId: string
  kind: TrialCreditKind
  amount?: number
  source?: string | null
  sourceId?: string | null
}) {
  const amount = Math.max(1, Math.floor(input.amount ?? 1))
  const creditsBeforeDeduction = await getOrCreateTrialCredits(input.organizationId).catch((error) => {
    console.error("Trial credit deduction preflight failed", error)
    throw new ApiError(503, "TRIAL_CREDITS_UNAVAILABLE", "Unable to update free trial credits. Please try again.")
  })

  const remainingBeforeDeduction =
    input.kind === "INTERVIEW"
      ? creditsBeforeDeduction.interviewCreditsRemaining
      : creditsBeforeDeduction.screeningCreditsRemaining

  if (remainingBeforeDeduction < amount) {
    const label = input.kind === "INTERVIEW" ? "interview" : "screening"
    throw new ApiError(
      402,
      "FREE_TRIAL_LIMIT_REACHED",
      remainingBeforeDeduction <= 0
        ? FREE_TRIAL_LIMIT_MESSAGE
        : `This action needs ${amount} ${label} credit${amount === 1 ? "" : "s"}, but your workspace has ${remainingBeforeDeduction} left. Reduce the selection or upgrade your workspace.`
    )
  }

  if (creditsBeforeDeduction.source === "subscription") {
    if (!creditsBeforeDeduction.subscriptionId) {
      throw new ApiError(503, "SUBSCRIPTION_CREDITS_UNAVAILABLE", "Unable to update subscription credits. Please try again.")
    }

    try {
      return await deductSubscriptionCredits({
        organizationId: input.organizationId,
        kind: input.kind,
        amount,
        subscriptionId: creditsBeforeDeduction.subscriptionId,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }

      console.error("Subscription credit table update failed", error)
      invalidateTrialCreditDashboardCache(input.organizationId)
      throw new ApiError(503, "SUBSCRIPTION_CREDITS_UPDATE_FAILED", "Unable to update subscription credits. Please try again.")
    }
  }

  try {
    const rows = input.kind === "INTERVIEW"
      ? await prisma.$queryRaw<TrialCreditRow[]>(Prisma.sql`
        update public.workspace_trial_credits
        set
          interview_credits_remaining = interview_credits_remaining - ${amount},
          updated_at = now()
        where organization_id = ${input.organizationId}::uuid
          and interview_credits_remaining >= ${amount}
        returning
          organization_id::text,
          interview_credits_remaining,
          screening_credits_remaining
      `)
      : await prisma.$queryRaw<TrialCreditRow[]>(Prisma.sql`
        update public.workspace_trial_credits
        set
          screening_credits_remaining = screening_credits_remaining - ${amount},
          updated_at = now()
        where organization_id = ${input.organizationId}::uuid
          and screening_credits_remaining >= ${amount}
        returning
          organization_id::text,
          interview_credits_remaining,
          screening_credits_remaining
      `)

    const row = rows[0]
    if (!row) {
      throw new ApiError(402, "FREE_TRIAL_LIMIT_REACHED", FREE_TRIAL_LIMIT_MESSAGE)
    }

    await recordTrialCreditEvent({
      organizationId: input.organizationId,
      kind: input.kind,
      amount,
      source: input.source ?? "deduction",
      sourceId: input.sourceId ?? null,
      remainingAfter: row,
    })

    const snapshot = mapTrialCreditRow(row)
    invalidateTrialCreditDashboardCache(input.organizationId)
    return snapshot
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    console.error("Trial credit table update failed", error)
    invalidateTrialCreditDashboardCache(input.organizationId)
    throw new ApiError(503, "TRIAL_CREDITS_UPDATE_FAILED", "Unable to update free trial credits. Please try again.")
  }
}

async function recordTrialCreditEvent(input: {
  organizationId: string
  kind: TrialCreditKind
  amount: number
  source: string
  sourceId: string | null
  remainingAfter: TrialCreditRow
}) {
  await prisma.$executeRaw(Prisma.sql`
    insert into public.workspace_trial_credit_events (
      organization_id,
      kind,
      amount,
      source,
      source_id,
      metadata
    )
    values (
      ${input.organizationId}::uuid,
      ${input.kind},
      ${input.amount},
      ${input.source},
      ${input.sourceId},
      ${JSON.stringify({ remainingAfter: {
        interviewCreditsRemaining: input.remainingAfter.interview_credits_remaining,
        screeningCreditsRemaining: input.remainingAfter.screening_credits_remaining,
      } })}::jsonb
    )
  `).catch((error) => {
    console.warn("Trial credit audit event write skipped", error)
  })
}
