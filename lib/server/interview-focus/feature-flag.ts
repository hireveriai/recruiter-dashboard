/**
 * Rollout flag for Interview Focus.
 *
 *   INTERVIEW_FOCUS_ENABLED=true            turns the feature on
 *   INTERVIEW_FOCUS_ORG_IDS=uuid,uuid       optional allowlist; when set, only
 *                                           these organizations get it
 *
 * Off by default. With the flag off nothing reads or writes focus plans and
 * question generation follows the legacy path exactly.
 */

function parseList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function isInterviewFocusFlagEnabled(organizationId: string | null | undefined) {
  const flag = String(process.env.INTERVIEW_FOCUS_ENABLED ?? "").trim().toLowerCase()
  if (flag !== "true" && flag !== "1") return false

  const allowlist = parseList(process.env.INTERVIEW_FOCUS_ORG_IDS)
  if (allowlist.length === 0) return true

  return Boolean(organizationId) && allowlist.includes(String(organizationId).toLowerCase())
}
