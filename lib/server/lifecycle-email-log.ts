import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"

/**
 * Idempotency + delivery log for the recruiter lifecycle emails (trial
 * requested/approved, subscription/bundle/addon activated). One row per
 * (emailType, dedupeKey): the insert is the lock, so a retried webhook call,
 * a double-clicked admin approval, or a replayed /verify-payment request can
 * claim the row at most once. Follows the same self-healing schema
 * convention already used by lib/server/entitlements.ts
 * (ensureEntitlementSchema) rather than depending solely on a migration
 * having been applied first.
 */

export type LifecycleEmailType =
  | "TRIAL_REQUESTED"
  | "TRIAL_APPROVED"
  | "SUBSCRIPTION_ACTIVATED"
  | "BUNDLE_ACTIVATED"
  | "ADDON_ACTIVATED"

let schemaEnsured = false

async function ensureLifecycleEmailSchema() {
  if (schemaEnsured) {
    return
  }

  await prisma.$executeRaw(Prisma.sql`
    create table if not exists public.lifecycle_email_deliveries (
      delivery_id uuid primary key default gen_random_uuid(),
      organization_id uuid null references public.organizations(organization_id) on delete set null,
      email_type text not null,
      dedupe_key text not null,
      status text not null default 'PENDING',
      sent_at timestamptz null,
      last_error text null,
      created_at timestamptz not null default now(),
      unique (email_type, dedupe_key)
    )
  `)

  schemaEnsured = true
}

/**
 * Claim the single allowed send for this event. Returns null when another
 * call already claimed it (expected on retries/double-submits) - callers
 * should skip sending in that case.
 */
export async function claimLifecycleEmail(input: {
  emailType: LifecycleEmailType
  dedupeKey: string
  organizationId?: string | null
}): Promise<string | null> {
  await ensureLifecycleEmailSchema()

  const rows = await prisma.$queryRaw<Array<{ delivery_id: string }>>(Prisma.sql`
    insert into public.lifecycle_email_deliveries (organization_id, email_type, dedupe_key, status)
    values (${input.organizationId ?? null}::uuid, ${input.emailType}, ${input.dedupeKey}, 'PENDING')
    on conflict (email_type, dedupe_key) do nothing
    returning delivery_id
  `)

  return rows[0]?.delivery_id ?? null
}

export async function markLifecycleEmail(deliveryId: string, status: "SENT" | "FAILED", error?: unknown) {
  await ensureLifecycleEmailSchema()

  await prisma.$executeRaw(Prisma.sql`
    update public.lifecycle_email_deliveries
    set
      status = ${status},
      sent_at = case when ${status} = 'SENT' then now() else sent_at end,
      last_error = ${error ? String(error instanceof Error ? error.message : error).slice(0, 2000) : null}
    where delivery_id = ${deliveryId}::uuid
  `)
}

type OrgContactRow = {
  name: string | null
  email: string | null
}

/**
 * Best-effort recipient/name resolution by organization only (no
 * user/session context available) - used for the trial-approval email,
 * where the admin decision route only has the trial request's stored
 * contact email. Prefers the workspace owner/admin so the greeting name
 * matches who actually manages the account.
 */
export async function getOrganizationPrimaryContact(organizationId: string): Promise<OrgContactRow> {
  const rows = await prisma.$queryRaw<OrgContactRow[]>(Prisma.sql`
    select full_name as name, email
    from public.users
    where organization_id = ${organizationId}::uuid
    order by
      case role
        when 'ORG_OWNER' then 0
        when 'ADMIN' then 1
        else 2
      end,
      created_at asc
    limit 1
  `).catch(() => [] as OrgContactRow[])

  return rows[0] ?? { name: null, email: null }
}
