import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { ApiError } from "@/lib/server/errors"
import { isVerisLiveFlagEnabled } from "@/lib/server/veris-live/feature-flag"

/**
 * Every recruiter-side VERIS Live route: authenticated recruiter session,
 * organization-scoped, feature-flagged. With the flag off the routes answer
 * 404 so the feature is indistinguishable from absent.
 */
export async function requireVerisLiveRecruiter(request: Request) {
  const auth = await getRecruiterRequestContext(request)
  if (!isVerisLiveFlagEnabled(auth.organizationId)) {
    throw new ApiError(404, "NOT_FOUND", "Not found.")
  }
  await assertEntitlement(auth, "AI_INTERVIEW")
  return auth
}
