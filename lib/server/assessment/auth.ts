import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import type { RecruiterRequestContext } from "@/lib/server/auth-context"

/**
 * Permission check for VERIS Assessment routes. Mirrors the shape of
 * assertCanManageUsers in app/api/manage-team/route.ts: role_permissions +
 * recruiter_user_permission_overrides, scoped to organizationId, joined
 * through public.permissions (permission codes must exist there too).
 */
export async function assertCanAssessment(
  auth: RecruiterRequestContext,
  permission:
    | "assessments.view"
    | "assessments.create"
    | "assessments.edit"
    | "assessments.publish"
    | "assessments.send"
    | "assessments.view_results"
    | "assessments.manage",
) {
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
