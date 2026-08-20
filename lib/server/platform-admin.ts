import { Prisma } from "@prisma/client"

import { RecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

export type PlatformAdmin = {
  email: string
  userId: string
  organizationId: string
}

function allowlistedEmails() {
  return (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

async function getAuthenticatedEmail(auth: RecruiterRequestContext) {
  const rows = await prisma.$queryRaw<Array<{ email: string | null }>>(Prisma.sql`
    select lower(u.email) as email
    from public.users u
    where u.user_id::text = ${auth.userId}
      and u.is_active = true
    limit 1
  `)

  return rows[0]?.email ?? null
}

async function isRegisteredPlatformAdmin(email: string) {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      select exists (
        select 1
        from public.platform_admins
        where email_normalized = ${email}
          and is_active = true
      ) as exists
    `)

    return rows[0]?.exists ?? false
  } catch {
    // Table not present yet (migration 012 not applied) — fall back to the
    // environment allowlist only.
    return false
  }
}

/**
 * Trial review is a platform-staff action, not an organization-admin action:
 * an org admin approving their own workspace's trial would defeat the point.
 * Membership comes from PLATFORM_ADMIN_EMAILS or the platform_admins table.
 */
export async function requirePlatformAdmin(auth: RecruiterRequestContext): Promise<PlatformAdmin> {
  const email = await getAuthenticatedEmail(auth)

  if (!email) {
    throw new ApiError(403, "PLATFORM_ADMIN_REQUIRED", "This area is restricted.")
  }

  const allowed = allowlistedEmails().includes(email) || (await isRegisteredPlatformAdmin(email))

  if (!allowed) {
    throw new ApiError(403, "PLATFORM_ADMIN_REQUIRED", "This area is restricted.")
  }

  return { email, userId: auth.userId, organizationId: auth.organizationId }
}

export async function isPlatformAdmin(auth: RecruiterRequestContext) {
  try {
    await requirePlatformAdmin(auth)
    return true
  } catch {
    return false
  }
}
