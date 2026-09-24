/**
 * Rollout flag for VERIS Live Interview.
 *
 *   VERIS_LIVE_ENABLED=true          turns the feature on
 *   VERIS_LIVE_ORG_IDS=uuid,uuid     optional allowlist; when set, only these
 *                                    organizations see VERIS Live
 *
 * Off by default. With it off the Send Interview Link flow is exactly the
 * existing VERIS AI Interview flow and no Live route accepts requests.
 */

export function isVerisLiveFlagEnabled(organizationId: string | null | undefined) {
  const flag = String(process.env.VERIS_LIVE_ENABLED ?? "").trim().toLowerCase()
  if (flag !== "true" && flag !== "1") return false

  const allowlist = String(process.env.VERIS_LIVE_ORG_IDS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.length === 0) return true

  return Boolean(organizationId) && allowlist.includes(String(organizationId).toLowerCase())
}
