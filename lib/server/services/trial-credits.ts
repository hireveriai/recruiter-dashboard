import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { attributeInterviewFault } from "@/lib/server/services/interview-fault-attribution"

import {
  evaluateEntitlementGate,
  FREE_TRIAL_INTERVIEW_CREDITS,
  FREE_TRIAL_LIMIT_MESSAGE,
  FREE_TRIAL_NOT_ACTIVE_MESSAGE,
  FREE_TRIAL_PENDING_MESSAGE,
  FREE_TRIAL_SCREENING_CREDITS,
  normalizeTrialStatus,
  resolveVisibleCredits,
  type CreditBalanceSource,
  type RecruiterTrialStatus,
} from "@/lib/server/services/trial-entitlement-policy"

export {
  FREE_TRIAL_INTERVIEW_CREDITS,
  FREE_TRIAL_SCREENING_CREDITS,
  FREE_TRIAL_LIMIT_MESSAGE,
  FREE_TRIAL_NOT_ACTIVE_MESSAGE,
  FREE_TRIAL_PENDING_MESSAGE,
}
export type { CreditBalanceSource, RecruiterTrialStatus }

export type TrialCreditKind = "INTERVIEW" | "SCREENING"

export type TrialCreditSnapshot = {
  organizationId: string
  interviewCreditsRemaining: number
  screeningCreditsRemaining: number
  canSendInterview: boolean
  canStartScreening: boolean
  upgradeMessage: string
  source: CreditBalanceSource
  /**
   * Lifecycle of the organization's free trial. Only "APPROVED" makes free
   * trial credits consumable; every other value means the workspace has no
   * free entitlement, whatever the balance column happens to say.
   */
  trialStatus: RecruiterTrialStatus
  trialActive: boolean
  subscriptionId?: string | null
  planId?: string | null
  subscriptionStatus?: string | null
  subscriptionExpiresAt?: string | null
}

type TrialCreditRow = {
  organization_id: string
  interview_credits_remaining: number
  screening_credits_remaining: number
  trial_status?: string | null
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
  balance_source: CreditBalanceSource
  subscription_id: string | null
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
  const trialStatus = normalizeTrialStatus(row.trial_status)
  const visible = resolveVisibleCredits({
    source: "trial",
    trialStatus,
    interviewCreditsRemaining: row.interview_credits_remaining,
    screeningCreditsRemaining: row.screening_credits_remaining,
  })

  return {
    organizationId: row.organization_id,
    interviewCreditsRemaining: visible.interviewCreditsRemaining,
    screeningCreditsRemaining: visible.screeningCreditsRemaining,
    canSendInterview: visible.canSendInterview,
    canStartScreening: visible.canStartScreening,
    upgradeMessage: visible.trialActive
      ? FREE_TRIAL_LIMIT_MESSAGE
      : trialStatus === "PENDING_REVIEW"
        ? FREE_TRIAL_PENDING_MESSAGE
        : FREE_TRIAL_NOT_ACTIVE_MESSAGE,
    source: "trial",
    trialStatus,
    trialActive: visible.trialActive,
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
    // Paid workspaces are not gated by the free-trial lifecycle at all.
    trialStatus: "APPROVED",
    trialActive: true,
    subscriptionId: row.id,
    planId: row.plan_id,
    subscriptionStatus: row.status,
    subscriptionExpiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  }
}

/**
 * A brand new workspace starts with nothing. Free credits only appear after a
 * trial request has been reviewed and approved.
 */
export function createInitialTrialCreditSnapshot(organizationId: string): TrialCreditSnapshot {
  return {
    organizationId,
    interviewCreditsRemaining: 0,
    screeningCreditsRemaining: 0,
    canSendInterview: false,
    canStartScreening: false,
    upgradeMessage: FREE_TRIAL_NOT_ACTIVE_MESSAGE,
    source: "trial",
    trialStatus: "NOT_REQUESTED",
    trialActive: false,
  }
}

export async function ensureTrialCreditSchema(client: QueryClient = prisma) {
  if (client === prisma && ensureTrialCreditSchemaPromise) {
    return ensureTrialCreditSchemaPromise
  }

  const ensurePromise = (async () => {
    // New workspaces start at zero. Credits are only ever written by an
    // approved trial grant or by a paid subscription.
    await client.$executeRaw(Prisma.sql`
    create table if not exists public.workspace_trial_credits (
      organization_id uuid primary key references public.organizations(organization_id) on delete cascade,
      interview_credits_remaining integer not null default 0,
      screening_credits_remaining integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint workspace_trial_credits_interview_non_negative check (interview_credits_remaining >= 0),
      constraint workspace_trial_credits_screening_non_negative check (screening_credits_remaining >= 0)
    )
  `)

    await client.$executeRaw(Prisma.sql`
    alter table public.workspace_trial_credits
      add column if not exists interview_credits_remaining integer not null default 0,
      add column if not exists screening_credits_remaining integer not null default 0,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now()
  `)

    // Introducing trial_status must not silently strip credits from workspaces
    // that predate the request flow. If the column does not exist yet, every
    // existing row is grandfathered to APPROVED in the same transaction that
    // adds it — so it does not matter whether this bootstrap or migration 012
    // runs first.
    await client.$executeRawUnsafe(`
    do $add_trial_status$
    declare
      v_column_existed boolean;
    begin
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'workspace_trial_credits'
          and column_name = 'trial_status'
      ) into v_column_existed;

      alter table public.workspace_trial_credits
        add column if not exists trial_status text not null default 'NOT_REQUESTED',
        add column if not exists trial_request_id uuid,
        add column if not exists trial_granted_at timestamptz,
        add column if not exists trial_expires_at timestamptz;

      if not v_column_existed then
        update public.workspace_trial_credits
        set trial_status = 'APPROVED',
            trial_granted_at = coalesce(trial_granted_at, created_at);
      end if;
    end
    $add_trial_status$;
  `)

    // Deployments created before migration 012 may still carry the old
    // defaults; make them harmless.
    await client.$executeRaw(Prisma.sql`
    alter table public.workspace_trial_credits
      alter column interview_credits_remaining set default 0,
      alter column screening_credits_remaining set default 0
  `).catch((error) => {
      console.warn("Trial credit default reset skipped", error)
    })

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
  // Creating an organization must never grant credits any more. The trigger
  // that used to seed 10 + 25 on every insert is removed here so that a stale
  // deployment or a partially applied migration cannot resurrect it.
  await client.$executeRawUnsafe(`
  drop trigger if exists organizations_seed_workspace_trial_credits on public.organizations;
`).catch((error) => {
    console.warn("Trial credit auto-seed trigger removal skipped", error)
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
      null::timestamptz as expires_at
    from public.hireveri_user_subscriptions
    where "organizationId" = ${organizationId}::uuid
      and lower(coalesce(status, '')) = 'active'
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
  // Bootstrapping a balance row must not hand out anything. It only records
  // that the workspace exists and has not requested a trial yet.
  const insertedRows = await client.$queryRaw<TrialCreditRow[]>(Prisma.sql`
    insert into public.workspace_trial_credits (
      organization_id,
      interview_credits_remaining,
      screening_credits_remaining,
      trial_status
    )
    values (
      ${organizationId}::uuid,
      0,
      0,
      'NOT_REQUESTED'
    )
    on conflict (organization_id) do nothing
    returning
      organization_id::text,
      interview_credits_remaining,
      screening_credits_remaining,
      trial_status
  `)

  return insertedRows.length > 0
    ? insertedRows
    : await client.$queryRaw<TrialCreditRow[]>(Prisma.sql`
      select
        organization_id::text,
        interview_credits_remaining,
        screening_credits_remaining,
        trial_status
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
  source?: string | null
  sourceIds?: string[]
}) {
  return prisma.$transaction(async (tx) => {
    const rows = input.kind === "INTERVIEW"
      ? await tx.$queryRaw<SubscriptionCreditRow[]>(Prisma.sql`
      update public.hireveri_user_subscriptions
      set
        "totalCredits" = "totalCredits" - ${input.amount},
        "usedCredits" = coalesce("usedCredits", 0) + ${input.amount},
        "updatedAt" = now()
      where id = ${input.subscriptionId}
        and "organizationId" = ${input.organizationId}::uuid
        and lower(coalesce(status, '')) = 'active'
        and "totalCredits" >= ${input.amount}
      returning
        id,
        "organizationId"::text as organization_id,
        "planId" as plan_id,
        status,
        "totalCredits" as interview_credits_remaining,
        "screeningCredits" as screening_credits_remaining,
        null::timestamptz as expires_at
    `)
      : await tx.$queryRaw<SubscriptionCreditRow[]>(Prisma.sql`
      update public.hireveri_user_subscriptions
      set
        "screeningCredits" = "screeningCredits" - ${input.amount},
        "updatedAt" = now()
      where id = ${input.subscriptionId}
        and "organizationId" = ${input.organizationId}::uuid
        and lower(coalesce(status, '')) = 'active'
        and "screeningCredits" >= ${input.amount}
      returning
        id,
        "organizationId"::text as organization_id,
        "planId" as plan_id,
        status,
        "totalCredits" as interview_credits_remaining,
        "screeningCredits" as screening_credits_remaining,
        null::timestamptz as expires_at
    `)

    const row = rows[0]
    if (!row) {
      throw new ApiError(402, "SUBSCRIPTION_CREDITS_EXHAUSTED", "Your subscription does not have enough credits for this action.")
    }

    await recordCreditDeductionEvents({
      client: tx,
      organizationId: input.organizationId,
      kind: input.kind,
      amount: input.amount,
      source: input.source ?? "deduction",
      sourceIds: input.sourceIds ?? [],
      metadata: {
        balanceSource: "subscription",
        subscriptionId: input.subscriptionId,
      },
    })

    invalidateTrialCreditDashboardCache(input.organizationId)
    return mapSubscriptionCreditRow(row)
  })
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
      ii.expires_at,
      coalesce(deduction.metadata->>'balanceSource', 'trial') as balance_source,
      nullif(deduction.metadata->>'subscriptionId', '') as subscription_id
    from public.interview_invites ii
    inner join public.interviews i
      on i.interview_id = ii.interview_id
    inner join public.workspace_trial_credit_events deduction
      on deduction.organization_id = i.organization_id
      and deduction.kind = 'INTERVIEW'
      and deduction.source in ('interview_link', 'interview_batch')
      and deduction.source_id = i.interview_id::text
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
          and evt.source_id = i.interview_id::text
      )
    order by ii.expires_at asc nulls last, ii.created_at asc
    limit 250
  `)
}

async function insertRefundEvent(input: {
  client: QueryClient
  organizationId: string
  invite: RefundableInviteRow
}) {
  const rows = await input.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
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
      ${input.invite.interview_id},
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

/**
 * Returns one interview credit to whichever balance it was taken from. Takes
 * only the balance fields (not a full invite row) so both the expired-link
 * refund and the platform-failure refund can share it unchanged.
 */
async function refundOneInterviewCredit(input: {
  client: QueryClient
  organizationId: string
  invite: Pick<RefundableInviteRow, "balance_source" | "subscription_id">
}) {
  if (input.invite.balance_source === "subscription" && input.invite.subscription_id) {
    const updated = await input.client.$executeRaw(Prisma.sql`
      update public.hireveri_user_subscriptions
      set
        "totalCredits" = "totalCredits" + 1,
        "usedCredits" = greatest(coalesce("usedCredits", 0) - 1, 0),
        "updatedAt" = now()
      where id = ${input.invite.subscription_id}
        and "organizationId" = ${input.organizationId}::uuid
    `)
    if (Number(updated) !== 1) {
      throw new Error("Original subscription balance was not found for interview refund")
    }
    return
  }

  await upsertTrialCreditRow(input.organizationId, input.client)
  await input.client.$executeRaw(Prisma.sql`
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
    const didRefund = await prisma.$transaction(async (tx) => {
      const eventInserted = await insertRefundEvent({
        client: tx,
        organizationId: input.organizationId,
        invite,
      })
      if (!eventInserted) return false
      await refundOneInterviewCredit({
        client: tx,
        organizationId: input.organizationId,
        invite,
      })
      return true
    })
    if (didRefund) refunded += 1
  }

  if (refunded > 0) {
    invalidateTrialCreditDashboardCache(input.organizationId)
  }

  return { refunded }
}

export async function refundAllExpiredUnusedInterviewCredits() {
  await ensureTrialCreditSchema()
  const organizations = await prisma.$queryRaw<Array<{ organization_id: string }>>(Prisma.sql`
    select distinct i.organization_id::text as organization_id
    from public.interview_invites ii
    inner join public.interviews i on i.interview_id = ii.interview_id
    inner join public.workspace_trial_credit_events deduction
      on deduction.organization_id = i.organization_id
      and deduction.kind = 'INTERVIEW'
      and deduction.source in ('interview_link', 'interview_batch')
      and deduction.source_id = i.interview_id::text
    where coalesce(upper(ii.access_type), '') <> 'RECOVERY'
      and ii.used_at is null
      and (
        upper(coalesce(ii.status, 'ACTIVE')) in ('EXPIRED', 'REVOKED')
        or ii.expires_at <= now()
      )
      and not exists (
        select 1
        from public.workspace_trial_credit_events refund
        where refund.organization_id = i.organization_id
          and refund.kind = 'INTERVIEW'
          and refund.source = ${INTERVIEW_REFUND_EVENT_SOURCE}
          and refund.source_id = i.interview_id::text
      )
  `)

  let refunded = 0
  for (const organization of organizations) {
    const result = await refundExpiredUnusedInterviewCredits({
      organizationId: organization.organization_id,
    })
    refunded += result.refunded
  }

  return { organizations: organizations.length, refunded }
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

/**
 * The single server-side gate for free entitlements. Every consumption path
 * runs through this, so an unapproved workspace cannot spend trial credits by
 * calling the API directly.
 */
function assertTrialEntitlementActive(credits: TrialCreditSnapshot) {
  const gate = evaluateEntitlementGate({
    source: credits.source,
    trialStatus: credits.trialStatus,
  })

  if (!gate.allowed) {
    throw new ApiError(gate.status, gate.code, gate.message)
  }
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

  assertTrialEntitlementActive(credits)

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
  sourceIds?: string[]
}) {
  const amount = Math.max(1, Math.floor(input.amount ?? 1))
  const creditsBeforeDeduction = await getOrCreateTrialCredits(input.organizationId).catch((error) => {
    console.error("Trial credit deduction preflight failed", error)
    throw new ApiError(503, "TRIAL_CREDITS_UNAVAILABLE", "Unable to update free trial credits. Please try again.")
  })

  assertTrialEntitlementActive(creditsBeforeDeduction)

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
        source: input.source,
        sourceIds: input.sourceIds ?? (input.sourceId ? [input.sourceId] : []),
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
    return await prisma.$transaction(async (tx) => {
      const rows = input.kind === "INTERVIEW"
        ? await tx.$queryRaw<TrialCreditRow[]>(Prisma.sql`
        update public.workspace_trial_credits
        set
          interview_credits_remaining = interview_credits_remaining - ${amount},
          updated_at = now()
        where organization_id = ${input.organizationId}::uuid
          and trial_status = 'APPROVED'
          and interview_credits_remaining >= ${amount}
        returning
          organization_id::text,
          interview_credits_remaining,
          screening_credits_remaining,
          trial_status
      `)
        : await tx.$queryRaw<TrialCreditRow[]>(Prisma.sql`
        update public.workspace_trial_credits
        set
          screening_credits_remaining = screening_credits_remaining - ${amount},
          updated_at = now()
        where organization_id = ${input.organizationId}::uuid
          and trial_status = 'APPROVED'
          and screening_credits_remaining >= ${amount}
        returning
          organization_id::text,
          interview_credits_remaining,
          screening_credits_remaining,
          trial_status
      `)

      const row = rows[0]
      if (!row) {
        // The conditional UPDATE is the authoritative check: it fails either
        // because the trial is not active or because the balance ran out
        // between the preflight read and this statement.
        throw new ApiError(402, "FREE_TRIAL_LIMIT_REACHED", FREE_TRIAL_LIMIT_MESSAGE)
      }

      await recordCreditDeductionEvents({
        client: tx,
        organizationId: input.organizationId,
        kind: input.kind,
        amount,
        source: input.source ?? "deduction",
        sourceIds: input.sourceIds ?? (input.sourceId ? [input.sourceId] : []),
        metadata: {
          balanceSource: "trial",
          remainingAfter: {
            interviewCreditsRemaining: row.interview_credits_remaining,
            screeningCreditsRemaining: row.screening_credits_remaining,
          },
        },
      })

      const snapshot = mapTrialCreditRow(row)
      invalidateTrialCreditDashboardCache(input.organizationId)
      return snapshot
    })
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    console.error("Trial credit table update failed", error)
    invalidateTrialCreditDashboardCache(input.organizationId)
    throw new ApiError(503, "TRIAL_CREDITS_UPDATE_FAILED", "Unable to update free trial credits. Please try again.")
  }
}

async function recordCreditDeductionEvents(input: {
  client: QueryClient
  organizationId: string
  kind: TrialCreditKind
  amount: number
  source: string
  sourceIds: string[]
  metadata: Record<string, unknown>
}) {
  const sourceIds: Array<string | null> = input.sourceIds.filter(Boolean)
  if (sourceIds.length === 0) sourceIds.push(null)

  const amountPerSource = input.amount === sourceIds.length ? 1 : input.amount
  for (const sourceId of sourceIds) {
    await input.client.$executeRaw(Prisma.sql`
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
        ${amountPerSource},
        ${input.source},
        ${sourceId},
        ${JSON.stringify(input.metadata)}::jsonb
      )
      on conflict do nothing
    `)
  }
}

// ---------------------------------------------------------------------------
// Platform-failure interview credit refunds
//
// When VerisNova itself fails to capture an interview -- a lost answer record,
// a transcript our own repair pipeline could not recover, our media service
// restarting, a recording we failed to store -- the recruiter should not pay
// for it, and should not have to ask.
//
// This deliberately reuses the existing ledger rather than adding a parallel
// one. Idempotency comes from the partial unique index on
// (organization_id, kind, source, source_id): the refund event is inserted
// first with `on conflict do nothing`, and the balance is only moved when that
// insert actually created a row. A retried request, a page refresh, or two
// concurrent requests can therefore never refund the same interview twice.
// ---------------------------------------------------------------------------

const PLATFORM_FAILURE_REFUND_EVENT_SOURCE = "platform_failure_refund"
const PLATFORM_FAILURE_REFUND_REASON = "Platform-side interview recording failure"

export type PlatformFailureRefundCandidate = {
  interview_id: string
  organization_id: string
  balance_source: CreditBalanceSource
  subscription_id: string | null
  attempt_status: string | null
  interruption_reason: string | null
  disconnect_reason: string | null
  termination_type: string | null
  recording_status: string | null
  reconnect_count: number | null
  transcript_integrity: {
    status?: string | null
    remainingIssues?: number | null
    createdPlaceholders?: number | null
    repairedAnswers?: number | null
  } | null
}

/**
 * Narrows to interviews that (a) actually had a credit deducted, (b) carry at
 * least one platform-failure marker, and (c) have not already been refunded.
 *
 * This SQL only pre-filters; the authoritative verdict is still
 * attributeInterviewFault() in TypeScript, so the refund rule and the message
 * shown to the recruiter can never disagree.
 */
async function getPlatformFailureRefundCandidates(
  organizationId: string,
  interviewIds?: string[]
) {
  const interviewFilter =
    interviewIds && interviewIds.length > 0
      ? Prisma.sql`and i.interview_id = any(${interviewIds}::uuid[])`
      : Prisma.empty

  return prisma.$queryRaw<PlatformFailureRefundCandidate[]>(Prisma.sql`
    with latest_attempt as (
      select distinct on (ia.interview_id)
        ia.interview_id,
        ia.status,
        ia.interruption_reason,
        ia.disconnect_reason,
        ia.termination_type,
        ia.recording_status,
        ia.reconnect_count,
        ia.termination_metadata -> 'transcript_integrity' as transcript_integrity
      from public.interview_attempts ia
      order by ia.interview_id, ia.started_at desc nulls last
    )
    select
      i.interview_id::text,
      i.organization_id::text,
      coalesce(deduction.metadata->>'balanceSource', 'trial') as balance_source,
      nullif(deduction.metadata->>'subscriptionId', '') as subscription_id,
      la.status as attempt_status,
      la.interruption_reason,
      la.disconnect_reason,
      la.termination_type,
      la.recording_status,
      la.reconnect_count,
      la.transcript_integrity
    from public.interviews i
    inner join latest_attempt la
      on la.interview_id = i.interview_id
    inner join public.workspace_trial_credit_events deduction
      on deduction.organization_id = i.organization_id
      and deduction.kind = 'INTERVIEW'
      and deduction.source in ('interview_link', 'interview_batch')
      and deduction.source_id = i.interview_id::text
    where i.organization_id = ${organizationId}::uuid
      ${interviewFilter}
      and (
        coalesce((la.transcript_integrity->>'createdPlaceholders')::int, 0) > 0
        or coalesce((la.transcript_integrity->>'remainingIssues')::int, 0) > 0
        or la.transcript_integrity->>'status' = 'needs_review'
        or upper(coalesce(la.recording_status, '')) = 'FAILED'
        or lower(coalesce(la.interruption_reason, '') || ' ' || coalesce(la.disconnect_reason, '')) like '%camera stream interrupted%'
        or lower(coalesce(la.interruption_reason, '') || ' ' || coalesce(la.disconnect_reason, '')) like '%realtime interview link was interrupted%'
        or lower(coalesce(la.interruption_reason, '') || ' ' || coalesce(la.disconnect_reason, '')) like '%realtime interview connection ended unexpectedly%'
      )
      and not exists (
        select 1
        from public.workspace_trial_credit_events refund
        where refund.organization_id = i.organization_id
          and refund.kind = 'INTERVIEW'
          and refund.source = ${PLATFORM_FAILURE_REFUND_EVENT_SOURCE}
          and refund.source_id = i.interview_id::text
      )
    limit 250
  `)
}

async function insertPlatformFailureRefundEvent(input: {
  client: QueryClient
  organizationId: string
  interviewId: string
  faultCode: string
  unrecoveredResponses: number
  reconstructedResponses: number
}) {
  const rows = await input.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
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
      ${PLATFORM_FAILURE_REFUND_EVENT_SOURCE},
      ${input.interviewId},
      ${JSON.stringify({
        refund: true,
        reason: PLATFORM_FAILURE_REFUND_REASON,
        faultParty: "VERISNOVA",
        faultCode: input.faultCode,
        interviewId: input.interviewId,
        unrecoveredResponses: input.unrecoveredResponses,
        reconstructedResponses: input.reconstructedResponses,
        refundedAt: new Date().toISOString(),
      })}::jsonb
    )
    on conflict do nothing
    returning id::text
  `)

  return rows.length > 0
}

/**
 * Refunds one interview credit for every interview in this workspace whose
 * latest attempt is attributable to a VerisNova platform failure.
 *
 * Safe to call on every page load: the pre-filter returns nothing for healthy
 * workspaces, and the unique index makes repeat calls no-ops.
 */
export async function refundPlatformFailureInterviewCredits(input: {
  organizationId: string
  interviewIds?: string[]
}) {
  if (!UUID_REGEX.test(input.organizationId)) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "Invalid recruiter workspace.")
  }

  await ensureTrialCreditSchema()

  const candidates = await getPlatformFailureRefundCandidates(
    input.organizationId,
    input.interviewIds
  )

  const refundedInterviewIds: string[] = []

  for (const candidate of candidates) {
    const fault = attributeInterviewFault({
      interruptionReason: candidate.interruption_reason,
      disconnectReason: candidate.disconnect_reason,
      terminationType: candidate.termination_type,
      attemptStatus: candidate.attempt_status,
      recordingStatus: candidate.recording_status,
      reconnectCount: candidate.reconnect_count,
      transcriptIntegrity: candidate.transcript_integrity,
    })

    // The classifier is the single authority. A candidate-side cause never
    // triggers a refund, even if the SQL pre-filter surfaced the row.
    if (fault.party !== "VERISNOVA") {
      continue
    }

    const didRefund = await prisma.$transaction(async (tx) => {
      const eventInserted = await insertPlatformFailureRefundEvent({
        client: tx,
        organizationId: input.organizationId,
        interviewId: candidate.interview_id,
        faultCode: fault.code,
        unrecoveredResponses: Number(candidate.transcript_integrity?.remainingIssues ?? 0),
        reconstructedResponses: Number(candidate.transcript_integrity?.createdPlaceholders ?? 0),
      })
      if (!eventInserted) return false

      await refundOneInterviewCredit({
        client: tx,
        organizationId: input.organizationId,
        invite: {
          balance_source: candidate.balance_source,
          subscription_id: candidate.subscription_id,
        },
      })
      return true
    })

    if (didRefund) {
      refundedInterviewIds.push(candidate.interview_id)
    }
  }

  if (refundedInterviewIds.length > 0) {
    invalidateTrialCreditDashboardCache(input.organizationId)
  }

  return { refunded: refundedInterviewIds.length, refundedInterviewIds }
}

/** Interview ids in this workspace already refunded for a platform failure. */
export async function getPlatformFailureRefundedInterviewIds(organizationId: string) {
  if (!UUID_REGEX.test(organizationId)) {
    return new Set<string>()
  }

  const rows = await prisma.$queryRaw<Array<{ source_id: string }>>(Prisma.sql`
    select source_id
    from public.workspace_trial_credit_events
    where organization_id = ${organizationId}::uuid
      and kind = 'INTERVIEW'
      and source = ${PLATFORM_FAILURE_REFUND_EVENT_SOURCE}
      and source_id is not null
  `)

  return new Set(rows.map((row) => row.source_id))
}

/**
 * Workspace-wide sweep for platform-failure refunds, mirroring
 * refundAllExpiredUnusedInterviewCredits. Driven by cron so that the credit
 * mutation lives in a background lifecycle rather than in a GET request.
 *
 * Deliberately has no date floor: interviews that already failed before this
 * shipped are refunded on the first run, which is the intended behaviour.
 */
export async function refundAllPlatformFailureInterviewCredits() {
  await ensureTrialCreditSchema()

  const organizations = await prisma.$queryRaw<Array<{ organization_id: string }>>(Prisma.sql`
    with latest_attempt as (
      select distinct on (ia.interview_id)
        ia.interview_id,
        ia.interruption_reason,
        ia.disconnect_reason,
        ia.recording_status,
        ia.termination_metadata -> 'transcript_integrity' as transcript_integrity
      from public.interview_attempts ia
      order by ia.interview_id, ia.started_at desc nulls last
    )
    select distinct i.organization_id::text as organization_id
    from public.interviews i
    inner join latest_attempt la
      on la.interview_id = i.interview_id
    inner join public.workspace_trial_credit_events deduction
      on deduction.organization_id = i.organization_id
      and deduction.kind = 'INTERVIEW'
      and deduction.source in ('interview_link', 'interview_batch')
      and deduction.source_id = i.interview_id::text
    where (
        coalesce((la.transcript_integrity->>'createdPlaceholders')::int, 0) > 0
        or coalesce((la.transcript_integrity->>'remainingIssues')::int, 0) > 0
        or la.transcript_integrity->>'status' = 'needs_review'
        or upper(coalesce(la.recording_status, '')) = 'FAILED'
        or lower(coalesce(la.interruption_reason, '') || ' ' || coalesce(la.disconnect_reason, '')) like '%camera stream interrupted%'
        or lower(coalesce(la.interruption_reason, '') || ' ' || coalesce(la.disconnect_reason, '')) like '%realtime interview link was interrupted%'
        or lower(coalesce(la.interruption_reason, '') || ' ' || coalesce(la.disconnect_reason, '')) like '%realtime interview connection ended unexpectedly%'
      )
      and not exists (
        select 1
        from public.workspace_trial_credit_events refund
        where refund.organization_id = i.organization_id
          and refund.kind = 'INTERVIEW'
          and refund.source = ${PLATFORM_FAILURE_REFUND_EVENT_SOURCE}
          and refund.source_id = i.interview_id::text
      )
  `)

  let refunded = 0
  for (const organization of organizations) {
    const result = await refundPlatformFailureInterviewCredits({
      organizationId: organization.organization_id,
    })
    refunded += result.refunded
  }

  return { organizations: organizations.length, refunded }
}
