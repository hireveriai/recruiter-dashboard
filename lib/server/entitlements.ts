import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

/**
 * Centralized organization-level product entitlements. This is Layer 1 of
 * two-layer authorization used across the recruiter dashboard:
 *
 *   ACCESS = Organization Entitlement (this file) AND User Permission
 *            (role_permissions / recruiter_user_permission_overrides, see
 *            lib/server/assessment/auth.ts, lib/server/employees/auth.ts,
 *            app/api/manage-team/route.ts's assertCanManageUsers)
 *
 * Entitlements answer "does this org's subscription include this module at
 * all" — never "does this recruiter personally have permission to use it"
 * (that's the existing RBAC system, untouched) and never "how many credits
 * are left" (that's lib/server/services/trial-credits.ts and
 * lib/server/services/assessment-credits.ts, also untouched). A module can
 * be entitled with zero credits remaining — the UI stays visible, only the
 * usage-consuming action is blocked, by the existing credit-check code.
 *
 * A module is derived from, in priority order:
 *   1. An explicit per-org override (organization_entitlement_overrides) —
 *      lets an admin grant a promo entitlement or revoke a module outright,
 *      independent of billing state.
 *   2. The org's active subscription's module flags (screening_enabled /
 *      assessment_enabled / interview_enabled on verisnova_user_subscriptions),
 *      set true whenever a plan or addon of that type is activated
 *      (lib/server/services/billing.ts verifyAndActivatePayment) and never
 *      cleared by a later purchase of a different type.
 *   3. An approved, unexpired free trial (workspace_trial_credits) — grants
 *      AI Interview + Screening only, matching the advertised trial offer in
 *      lib/server/services/trial-entitlement-policy.ts. Assessment is not
 *      part of the free trial.
 *   4. Employee Activities defaults to enabled everywhere because it has
 *      never been wired to billing (confirmed: no references to it in
 *      billing.ts or trial-entitlement-policy.ts) — treating it as gated by
 *      default would silently break every organization currently using it.
 *      Once it becomes a sellable module, wire its plan flag the same way
 *      Screening/Assessment/Interview are wired above, and flip this default.
 */

export type EntitlementCode = "AI_INTERVIEW" | "SCREENING" | "ASSESSMENT" | "EMPLOYEE_ACTIVITIES"

export const ALL_ENTITLEMENTS: EntitlementCode[] = ["AI_INTERVIEW", "SCREENING", "ASSESSMENT", "EMPLOYEE_ACTIVITIES"]

export const ENTITLEMENT_LABELS: Record<EntitlementCode, string> = {
  AI_INTERVIEW: "VERIS AI Interview",
  SCREENING: "VERIS Screening",
  ASSESSMENT: "VERIS Assessment",
  EMPLOYEE_ACTIVITIES: "Employee Activities",
}

export type EntitlementMap = Record<EntitlementCode, boolean>

function isEntitlementCode(value: string): value is EntitlementCode {
  return (ALL_ENTITLEMENTS as string[]).includes(value)
}

type SubscriptionRow = {
  status: string | null
  expires_at: string | null
  screening_enabled: boolean
  assessment_enabled: boolean
  interview_enabled: boolean
}

type TrialRow = {
  trial_status: string | null
  trial_expires_at: string | null
}

type OverrideRow = {
  entitlement_code: string
  is_enabled: boolean
}

let schemaEnsured = false

/**
 * Idempotent, self-healing schema setup — same convention used throughout
 * this app (see ensureManageTeamUserColumns in app/api/manage-team/route.ts,
 * or the inline ALTER/CREATE in lib/server/services/trial-credits.ts) rather
 * than relying solely on the numbered migration files under prisma/sql being
 * applied first. Cached per process since the schema doesn't change at
 * runtime once ensured.
 */
export async function ensureEntitlementSchema() {
  if (schemaEnsured) {
    return
  }

  await prisma.$executeRaw(Prisma.sql`
    alter table public.verisnova_user_subscriptions
      add column if not exists screening_enabled boolean not null default false,
      add column if not exists assessment_enabled boolean not null default false,
      add column if not exists interview_enabled boolean not null default false
  `)

  await prisma.$executeRaw(Prisma.sql`
    create table if not exists public.organization_entitlement_overrides (
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      entitlement_code text not null,
      is_enabled boolean not null,
      updated_by uuid null references public.users(user_id),
      updated_at timestamptz not null default now(),
      primary key (organization_id, entitlement_code)
    )
  `)

  schemaEnsured = true
}

/**
 * Resolve every module entitlement for an organization in a single pass —
 * callers should call this once per request/render (e.g. once in
 * /api/dashboard/overview, once in /api/me) and pass the resulting map down,
 * rather than calling hasEntitlement/assertEntitlement repeatedly per
 * widget/route, to avoid N+1 subscription queries.
 */
export async function getOrganizationEntitlements(organizationId: string): Promise<EntitlementMap> {
  await ensureEntitlementSchema()

  const [subscriptionRows, trialRows, overrideRows] = await Promise.all([
    prisma
      .$queryRaw<SubscriptionRow[]>(
        Prisma.sql`
          select
            status,
            "expiresAt"::text as expires_at,
            screening_enabled,
            assessment_enabled,
            interview_enabled
          from public.verisnova_user_subscriptions
          where "organizationId" = ${organizationId}::uuid
          limit 1
        `
      )
      .catch(() => [] as SubscriptionRow[]),
    prisma
      .$queryRaw<TrialRow[]>(
        Prisma.sql`
          select trial_status, trial_expires_at::text as trial_expires_at
          from public.workspace_trial_credits
          where organization_id = ${organizationId}::uuid
          limit 1
        `
      )
      .catch(() => [] as TrialRow[]),
    prisma
      .$queryRaw<OverrideRow[]>(
        Prisma.sql`
          select entitlement_code, is_enabled
          from public.organization_entitlement_overrides
          where organization_id = ${organizationId}::uuid
        `
      )
      .catch(() => [] as OverrideRow[]),
  ])

  const subscription = subscriptionRows[0]
  const subscriptionActive =
    Boolean(subscription) &&
    String(subscription?.status ?? "").toLowerCase() === "active" &&
    (!subscription?.expires_at || new Date(subscription.expires_at).getTime() > Date.now())

  const trial = trialRows[0]
  const trialActive =
    Boolean(trial) &&
    trial?.trial_status === "APPROVED" &&
    (!trial?.trial_expires_at || new Date(trial.trial_expires_at).getTime() > Date.now())

  const defaults: EntitlementMap = {
    AI_INTERVIEW: (subscriptionActive && Boolean(subscription?.interview_enabled)) || trialActive,
    SCREENING: (subscriptionActive && Boolean(subscription?.screening_enabled)) || trialActive,
    ASSESSMENT: subscriptionActive && Boolean(subscription?.assessment_enabled),
    EMPLOYEE_ACTIVITIES: true,
  }

  const overrides = new Map(
    overrideRows.filter((row) => isEntitlementCode(row.entitlement_code)).map((row) => [row.entitlement_code, row.is_enabled])
  )

  const result = {} as EntitlementMap
  for (const code of ALL_ENTITLEMENTS) {
    result[code] = overrides.has(code) ? Boolean(overrides.get(code)) : defaults[code]
  }

  return result
}

export async function hasEntitlement(organizationId: string, code: EntitlementCode): Promise<boolean> {
  const entitlements = await getOrganizationEntitlements(organizationId)
  return entitlements[code]
}

/**
 * Server-side enforcement gate for API routes and server components. Throws
 * a 403 the same way lib/server/assessment/auth.ts and
 * lib/server/employees/auth.ts throw INSUFFICIENT_PERMISSION — callers
 * should call this BEFORE the module's own assertCan*() user-permission
 * check, so an org that never bought a module gets a plan-upgrade message
 * rather than a misleading "ask your admin" permission error.
 */
export async function assertEntitlement(auth: { organizationId: string }, code: EntitlementCode): Promise<void> {
  const allowed = await hasEntitlement(auth.organizationId, code)

  if (!allowed) {
    throw new ApiError(
      403,
      "FEATURE_NOT_IN_PLAN",
      `${ENTITLEMENT_LABELS[code]} is not included in your current plan. Upgrade to unlock it.`,
      { entitlement: code }
    )
  }
}

/**
 * Admin-facing write path (called from the admin app / a future manage-team
 * "grant module" action) — never called from recruiter-facing routes.
 * Explicit override always wins over the plan-derived default, in either
 * direction, until cleared.
 */
export async function setOrganizationEntitlementOverride(input: {
  organizationId: string
  entitlementCode: EntitlementCode
  isEnabled: boolean
  updatedBy?: string | null
}): Promise<void> {
  await ensureEntitlementSchema()

  await prisma.$executeRaw(Prisma.sql`
    insert into public.organization_entitlement_overrides (
      organization_id,
      entitlement_code,
      is_enabled,
      updated_by,
      updated_at
    )
    values (
      ${input.organizationId}::uuid,
      ${input.entitlementCode},
      ${input.isEnabled},
      ${input.updatedBy ?? null}::uuid,
      now()
    )
    on conflict (organization_id, entitlement_code) do update
    set
      is_enabled = excluded.is_enabled,
      updated_by = excluded.updated_by,
      updated_at = now()
  `)
}

export async function clearOrganizationEntitlementOverride(input: {
  organizationId: string
  entitlementCode: EntitlementCode
}): Promise<void> {
  await ensureEntitlementSchema()

  await prisma.$executeRaw(Prisma.sql`
    delete from public.organization_entitlement_overrides
    where organization_id = ${input.organizationId}::uuid
      and entitlement_code = ${input.entitlementCode}
  `)
}
