import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { RecruiterRequestContext } from "@/lib/server/auth-context"

type RecruiterBaseRow = {
  recruiter_name: string | null
  recruiter_email: string
  organization_name: string | null
  timezone: string | null
  timezone_label: string | null
}

type RecruiterProfileRow = {
  profile_company_name: string | null
  recruiter_role_id: number | null
  recruiter_profile_exists: boolean
  permissions: string[] | null
}

type ExistsRow = {
  exists: boolean
}

export type RecruiterProfile = {
  name: string
  email: string
  organization: string
  timezone: string
  timezoneLabel: string
  userId: string
  organizationId: string
  recruiterRoleId: number | null
  permissions: string[]
  isAdmin: boolean
  recruiterProfileExists: boolean
  sessionCookieMatched: boolean
  sessionValidatedVia: "auth_session" | "identity_cookie" | "jwt"
}

async function tableExists(tableName: string) {
  const rows = await prisma.$queryRaw<ExistsRow[]>(Prisma.sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as exists
  `)

  return rows[0]?.exists ?? false
}

export async function getRecruiterProfile(auth: RecruiterRequestContext): Promise<RecruiterProfile> {
  let recruiter: RecruiterBaseRow | undefined

  try {
    const baseRows = await prisma.$queryRaw<RecruiterBaseRow[]>(Prisma.sql`
      select
        u.full_name as recruiter_name,
        u.email as recruiter_email,
        o.organization_name,
        o.timezone,
        o.timezone_label
      from public.users u
      left join public.organizations o
        on o.organization_id = u.organization_id
      where u.user_id::text = ${auth.userId}
        and u.organization_id::text = ${auth.organizationId}
        and u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
      limit 1
    `)

    recruiter = baseRows[0]
  } catch (error) {
    console.error("Recruiter base profile lookup failed", error)
    throw new ApiError(500, "RECRUITER_BASE_LOOKUP_FAILED", "Could not load recruiter workspace context")
  }

  if (!recruiter) {
    throw new ApiError(404, "RECRUITER_NOT_FOUND", "Recruiter not found for this authenticated session")
  }

  let profileCompanyName: string | null = null
  let recruiterRoleId: number | null = null
  let recruiterProfileExists = false
  let permissions: string[] = []

  await prisma.$queryRaw(Prisma.sql`
    select public.fn_ensure_default_recruiter_profile(
      ${auth.userId}::uuid,
      ${auth.organizationId}::uuid
    )
  `).catch((healingError) => {
    console.warn("Recruiter profile auto-heal skipped during /api/me bootstrap", healingError)
  })

  try {
    const hasUserPermissionOverrides = await tableExists("recruiter_user_permission_overrides").catch(() => false)
    const permissionsExpression = hasUserPermissionOverrides
      ? Prisma.sql`
          coalesce(
            array_agg(distinct pd.permission_code)
              filter (
                where pd.permission_code is not null
                  and (
                    (role_permissions.permission is not null and coalesce(user_permissions.is_granted, true) = true)
                    or user_permissions.is_granted = true
                  )
              ),
            array[]::text[]
          )`
      : Prisma.sql`
          coalesce(
            array_agg(distinct role_permissions.permission)
              filter (where role_permissions.permission is not null),
            array[]::text[]
          )`

    const profileRows = await prisma.$queryRaw<RecruiterProfileRow[]>(Prisma.sql`
      select
        rp.company_name as profile_company_name,
        rp.recruiter_role_id,
        (rp.recruiter_id is not null) as recruiter_profile_exists,
        ${permissionsExpression} as permissions
      from public.recruiter_profiles rp
      ${hasUserPermissionOverrides
        ? Prisma.sql`
            left join public.permissions pd
              on true
          `
        : Prisma.sql``}
      left join public.role_permissions role_permissions
        on role_permissions.recruiter_role_id = rp.recruiter_role_id
        ${hasUserPermissionOverrides ? Prisma.sql`and role_permissions.permission = pd.permission_code` : Prisma.sql``}
      ${hasUserPermissionOverrides
        ? Prisma.sql`
            left join public.recruiter_user_permission_overrides user_permissions
              on user_permissions.user_id = rp.recruiter_id
              and user_permissions.organization_id = rp.organization_id
              and user_permissions.permission_code = pd.permission_code
          `
        : Prisma.sql``}
      where rp.recruiter_id::text = ${auth.userId}
        and rp.organization_id::text = ${auth.organizationId}
      group by rp.company_name, rp.recruiter_role_id, rp.recruiter_id
      limit 1
    `)

    const profile = profileRows[0]

    if (profile) {
      profileCompanyName = profile.profile_company_name
      recruiterRoleId = profile.recruiter_role_id
      recruiterProfileExists = Boolean(profile.recruiter_profile_exists)
      permissions = profile.permissions ?? []
    }
  } catch (profileError) {
    console.warn("Recruiter profile lookup skipped during /api/me bootstrap", profileError)
  }

  const uniquePermissions = [...new Set(permissions.filter(Boolean))]

  return {
    name: recruiter.recruiter_name ?? recruiter.recruiter_email,
    email: recruiter.recruiter_email,
    organization: recruiter.organization_name ?? profileCompanyName ?? "",
    timezone: recruiter.timezone ?? "Asia/Kolkata",
    timezoneLabel: recruiter.timezone_label ?? "India Standard Time",
    userId: auth.userId,
    organizationId: auth.organizationId,
    recruiterRoleId,
    permissions: uniquePermissions,
    isAdmin: uniquePermissions.includes("users.manage"),
    recruiterProfileExists,
    sessionCookieMatched: auth.sessionCookieMatched,
    sessionValidatedVia: auth.sessionValidatedVia,
  }
}
