import { ENTITLEMENT_LABELS, type EntitlementCode } from "@/lib/server/entitlements"

/**
 * Turns raw entitlement/credit data into the bullet lines shown in lifecycle
 * emails (trial request, trial approved, subscription/bundle/addon active).
 *
 * This is presentation-only glue over the real source of truth
 * (getOrganizationEntitlements / the purchase's own grant flags) — it never
 * decides what an org has access to, only how to phrase what it was told.
 * EMPLOYEE_ACTIVITIES is intentionally never included: it isn't a sellable
 * module yet (see lib/server/entitlements.ts), so no email should ever list
 * it as something the recruiter "got".
 */

export type EntitlementSummaryEntry = {
  code: EntitlementCode
  granted: boolean
  /** Omit or leave null/undefined to show the feature name without a count. */
  credits?: number | null
  /**
   * True when the org already had this module before this event (e.g. an
   * existing Screening customer topping up credits) - phrases the line as
   * "N additional ..." rather than implying this is the module's first
   * grant. Ignored when the entry isn't `granted`.
   */
  additional?: boolean
}

const SELLABLE_ORDER: EntitlementCode[] = ["AI_INTERVIEW", "SCREENING", "ASSESSMENT"]

function describe(entry: EntitlementSummaryEntry): string {
  const hasCount = typeof entry.credits === "number" && Number.isFinite(entry.credits)
  const count = hasCount ? Math.max(0, Math.floor(entry.credits as number)) : null

  if (entry.code === "AI_INTERVIEW") {
    if (count === null) return ENTITLEMENT_LABELS.AI_INTERVIEW
    const noun = `AI Interview Session${count === 1 ? "" : "s"}`
    return entry.additional ? `${count} Additional ${noun}` : `${count} ${noun}`
  }

  if (entry.code === "SCREENING") {
    if (count === null) return ENTITLEMENT_LABELS.SCREENING
    const noun = `VERIS Screening Review${count === 1 ? "" : "s"}`
    return entry.additional ? `${count} Additional ${noun}` : `${count} ${noun}`
  }

  if (entry.code === "ASSESSMENT") {
    return entry.additional ? "Additional VERIS Assessment Credits" : "VERIS Assessments"
  }

  return ENTITLEMENT_LABELS[entry.code]
}

/**
 * Ordered, human-readable lines for the granted entries only — e.g.
 * ["10 AI Interview Sessions", "25 VERIS Screening Reviews", "VERIS Assessments"].
 * Never includes a module the caller didn't mark as granted, so a trial that
 * only offers Interview + Screening never mentions Assessment.
 */
export function buildEntitlementSummaryLines(entries: EntitlementSummaryEntry[]): string[] {
  const byCode = new Map(entries.map((entry) => [entry.code, entry]))

  return SELLABLE_ORDER.filter((code) => byCode.get(code)?.granted).map((code) => describe(byCode.get(code)!))
}

/** Inline "X + Y + Z" phrase for sentence use (e.g. "We received your request for X + Y"). */
export function buildEntitlementSummaryPhrase(lines: string[]): string {
  return lines.join(" + ")
}
