import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { assertEntitlement } from "@/lib/server/entitlements"
import { prisma } from "@/lib/server/prisma"
import type { RecruiterRequestContext } from "@/lib/server/auth-context"

/**
 * Permission check for Employees / Employee Assessments/Challenges/Tasks
 * routes. Exact same shape as assertCanAssessment in
 * lib/server/assessment/auth.ts (which itself mirrors assertCanManageUsers
 * in app/api/manage-team/route.ts): role_permissions +
 * recruiter_user_permission_overrides, scoped to organizationId, joined
 * through public.permissions.
 *
 * Checks BOTH authorization layers: the org's EMPLOYEE_ACTIVITIES
 * entitlement first (see lib/server/entitlements.ts), then the recruiter's
 * own permission. Employee Activities has never been a paid module (it
 * defaults to enabled for every org today), so this call is a no-op until an
 * admin explicitly disables it for a specific org or it becomes sellable.
 */
export async function assertCanEmployees(
  auth: RecruiterRequestContext,
  permission:
    | "employees.view"
    | "employees.create"
    | "employees.edit"
    | "employeeActivities.view"
    | "employeeActivities.create"
    | "employeeActivities.edit"
    | "employeeActivities.assign"
    | "employeeActivities.view_results"
    | "employeeActivities.review"
    | "employeeActivities.manage",
) {
  await assertEntitlement(auth, "EMPLOYEE_ACTIVITIES")

  const rows = await prisma.$queryRaw<{ can_access: boolean }[]>(Prisma.sql`
    select exists (
      select 1
      from public.recruiter_profiles arp
      left join public.permissions pd
        on pd.permission_code = ${permission}
      left join public.role_permissions perms
        on perms.recruiter_role_id = arp.recruiter_role_id
        and perms.permission = pd.permission_code
      left join public.recruiter_user_permission_overrides user_perms
        on user_perms.user_id = arp.recruiter_id
        and user_perms.organization_id = arp.organization_id
        and user_perms.permission_code = pd.permission_code
      where arp.recruiter_id = ${auth.userId}::uuid
        and arp.organization_id = ${auth.organizationId}::uuid
        and (
          (perms.permission is not null and coalesce(user_perms.is_granted, true) = true)
          or user_perms.is_granted = true
        )
    ) as can_access
  `)

  if (!rows[0]?.can_access) {
    throw new ApiError(403, "INSUFFICIENT_PERMISSION", `${permission} is required`)
  }
}

/**
 * True when the caller holds employeeActivities.manage (org-wide visibility).
 * Never throws — callers use this to decide how to scope a query, not to
 * gate access outright (employeeActivities.view_results already gates that).
 */
export async function hasOrgWideEmployeeActivityAccess(auth: RecruiterRequestContext): Promise<boolean> {
  try {
    await assertCanEmployees(auth, "employeeActivities.manage")
    return true
  } catch {
    return false
  }
}
