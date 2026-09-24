/**
 * Interview Focus rules: limits, validation, weight normalisation and slot
 * allocation.
 *
 * Coverage weights describe how much of the interview's QUESTION TIME goes to
 * each competency. They are never scoring weights.
 *
 * Pure functions only - no I/O - so every rule here is unit-testable and the
 * same rules apply to recruiter input, AI output and the deterministic
 * fallback. Nothing an AI returns reaches the database without passing through
 * normalizeCoverageWeights / validateFocusPlanInput.
 */

import { getCompetency, isLibraryCompetency } from "@/lib/server/interview-focus/competency-library"

export const RESUME_EMPHASIS_VALUES = ["OFF", "LIGHT", "STANDARD", "HEAVY"] as const
export type ResumeEmphasis = (typeof RESUME_EMPHASIS_VALUES)[number]

export const DEFAULT_STAGE_KEY = "primary"
export const TOTAL_COVERAGE = 100
export const COVERAGE_STEP = 5
export const MIN_AREA_COVERAGE = 10
export const MAX_CUSTOM_LABEL_LENGTH = 60
export const MAX_DESCRIPTION_LENGTH = 240

export type FocusArea = {
  areaKey: string
  label: string
  description: string | null
  isCustom: boolean
  sortOrder: number
  coverageWeight: number
}

export type FocusAreaInput = {
  areaKey?: string | null
  label?: string | null
  description?: string | null
  isCustom?: boolean | null
  coverageWeight?: number | string | null
}

/**
 * Maximum focus areas by interview length. A 30-minute interview has about
 * eight core questions, so more than five areas cannot each be covered.
 */
export function maxFocusAreasForDuration(durationMinutes: unknown) {
  const minutes = Number(durationMinutes)
  if (!Number.isFinite(minutes) || minutes < 45) return 5
  if (minutes < 60) return 6
  return 7
}

export function isResumeEmphasis(value: unknown): value is ResumeEmphasis {
  return RESUME_EMPHASIS_VALUES.includes(value as ResumeEmphasis)
}

/** Collapses whitespace and strips control characters; never throws. */
export function cleanFocusText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

export function customAreaKeyFromLabel(label: string, taken: Set<string>) {
  const slug =
    cleanFocusText(label, MAX_CUSTOM_LABEL_LENGTH)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "competency"
  const base = `custom_${slug}`
  let key = base
  let suffix = 2
  while (taken.has(key)) {
    key = `${base}_${suffix}`
    suffix += 1
  }
  return key
}

/**
 * Largest-remainder apportionment with a deterministic tie-break (earlier
 * index wins). Returns integers that sum to `total`.
 */
function apportion(total: number, shares: number[]) {
  const sum = shares.reduce((acc, value) => acc + value, 0)
  const exact = shares.map((share) => (sum > 0 ? (total * share) / sum : total / shares.length))
  const counts = exact.map((value) => Math.floor(value))
  let assigned = counts.reduce((acc, value) => acc + value, 0)

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value), share: shares[index] }))
    .sort((a, b) => b.remainder - a.remainder || b.share - a.share || a.index - b.index)

  for (let i = 0; assigned < total && order.length > 0; i = (i + 1) % order.length) {
    counts[order[i].index] += 1
    assigned += 1
  }

  return counts
}

/**
 * Turns any list of raw weights into valid coverage weights: multiples of 5,
 * each at least 10, summing to exactly 100, preserving relative size as
 * closely as possible. Used for AI output, the fallback and stale plans.
 * Requires 1-10 areas.
 */
export function normalizeCoverageWeights(rawWeights: Array<number | null | undefined>) {
  const count = rawWeights.length
  if (count === 0) return []
  if (count * MIN_AREA_COVERAGE > TOTAL_COVERAGE) {
    throw new Error(`Cannot give ${count} areas at least ${MIN_AREA_COVERAGE}% each`)
  }

  const units = TOTAL_COVERAGE / COVERAGE_STEP
  const minUnits = MIN_AREA_COVERAGE / COVERAGE_STEP
  const shares = rawWeights.map((value) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
  })

  // Scale proportionally first, so weights that are already valid come back
  // unchanged; then lift any area below the floor by taking from the largest
  // (ties: the later area gives, so the most important keeps its share).
  const counts = apportion(units, shares.some((s) => s > 0) ? shares : shares.map(() => 1))
  for (let index = 0; index < counts.length; index += 1) {
    while (counts[index] < minUnits) {
      let donor = -1
      counts.forEach((value, i) => {
        if (i !== index && value > minUnits && (donor === -1 || value >= counts[donor])) donor = i
      })
      counts[donor] -= 1
      counts[index] += 1
    }
  }

  return counts.map((value) => value * COVERAGE_STEP)
}

export type FocusValidationResult =
  | { ok: true; areas: FocusArea[]; resumeEmphasis: ResumeEmphasis }
  | { ok: false; errors: string[] }

/**
 * Strict validation of a plan as submitted by a recruiter. Unlike
 * normalizeCoverageWeights it never "fixes" the numbers: the recruiter sees
 * exactly what is wrong. Library areas always take their label and
 * description from the library, so a client cannot relabel them.
 */
export function validateFocusPlanInput(input: {
  areas: unknown
  resumeEmphasis: unknown
  durationMinutes: unknown
}): FocusValidationResult {
  const errors: string[] = []
  const maxAreas = maxFocusAreasForDuration(input.durationMinutes)
  const rawAreas = Array.isArray(input.areas) ? (input.areas as FocusAreaInput[]) : null

  if (!isResumeEmphasis(input.resumeEmphasis)) {
    errors.push("Choose a resume emphasis: Off, Light, Standard or Heavy.")
  }

  if (!rawAreas || rawAreas.length === 0) {
    return { ok: false, errors: [...errors, "Add at least one focus area."] }
  }

  if (rawAreas.length > maxAreas) {
    errors.push(`This interview length allows at most ${maxAreas} focus areas; remove ${rawAreas.length - maxAreas}.`)
  }

  const takenKeys = new Set<string>()
  const takenLabels = new Set<string>()
  const areas: FocusArea[] = []
  let total = 0

  rawAreas.forEach((raw, index) => {
    const position = `Focus area ${index + 1}`
    const requestedKey = cleanFocusText(raw?.areaKey, 80)
    const libraryEntry = requestedKey && isLibraryCompetency(requestedKey) ? getCompetency(requestedKey) : undefined
    const weight = Number(raw?.coverageWeight)

    let areaKey: string
    let label: string
    let description: string | null
    let isCustom: boolean

    if (libraryEntry) {
      areaKey = libraryEntry.key
      label = libraryEntry.label
      description = libraryEntry.description
      isCustom = false
    } else {
      label = cleanFocusText(raw?.label, MAX_CUSTOM_LABEL_LENGTH)
      description = cleanFocusText(raw?.description, MAX_DESCRIPTION_LENGTH) || null
      isCustom = true

      if (label.length < 2) {
        errors.push(`${position}: a custom competency needs a name of at least 2 characters.`)
      }

      // Keep an existing custom key stable across edits; otherwise derive one.
      areaKey =
        /^custom_[a-z0-9_]{1,56}$/.test(requestedKey) && !takenKeys.has(requestedKey)
          ? requestedKey
          : customAreaKeyFromLabel(label, takenKeys)
    }

    if (takenKeys.has(areaKey)) {
      errors.push(`${position}: "${label}" is listed more than once.`)
    }
    const labelKey = label.toLowerCase()
    if (label && takenLabels.has(labelKey) && !takenKeys.has(areaKey)) {
      errors.push(`${position}: another focus area is already called "${label}".`)
    }

    if (!Number.isInteger(weight)) {
      errors.push(`${position}: coverage must be a whole number.`)
    } else if (weight % COVERAGE_STEP !== 0) {
      errors.push(`${position}: coverage must be in steps of ${COVERAGE_STEP}%.`)
    } else if (weight < MIN_AREA_COVERAGE) {
      errors.push(`${position}: each focus area needs at least ${MIN_AREA_COVERAGE}% coverage.`)
    } else if (weight > TOTAL_COVERAGE) {
      errors.push(`${position}: coverage cannot exceed ${TOTAL_COVERAGE}%.`)
    }

    takenKeys.add(areaKey)
    takenLabels.add(labelKey)
    total += Number.isFinite(weight) ? weight : 0

    areas.push({ areaKey, label, description, isCustom, sortOrder: index + 1, coverageWeight: weight })
  })

  if (total !== TOTAL_COVERAGE) {
    errors.push(`Coverage adds up to ${total}%; it must total exactly ${TOTAL_COVERAGE}%.`)
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, areas, resumeEmphasis: input.resumeEmphasis as ResumeEmphasis }
}

/**
 * Deterministic allocation of question slots to focus areas.
 *
 * When there are at least as many slots as areas, every area gets one slot
 * and the rest are shared by coverage weight (largest remainder). With fewer
 * slots than areas, the highest-weighted areas get one each. Ties always go
 * to the earlier area, so the same plan and slot count always give the same
 * result. Returned counts are aligned with the input order and sum to `slots`.
 */
export function allocateFocusSlots(
  areas: ReadonlyArray<Pick<FocusArea, "coverageWeight">>,
  slots: number
): number[] {
  const total = Math.max(0, Math.floor(slots))
  if (areas.length === 0 || total === 0) return areas.map(() => 0)

  const weights = areas.map((area) => Math.max(0, Number(area.coverageWeight) || 0))

  if (total < areas.length) {
    const ranked = weights
      .map((weight, index) => ({ weight, index }))
      .sort((a, b) => b.weight - a.weight || a.index - b.index)
      .slice(0, total)
      .map((entry) => entry.index)
    return areas.map((_, index) => (ranked.includes(index) ? 1 : 0))
  }

  const extra = apportion(total - areas.length, weights.some((w) => w > 0) ? weights : weights.map(() => 1))
  return extra.map((value) => value + 1)
}

/**
 * Brings a stored plan within the current duration limit: keeps the
 * highest-weighted areas (ties keep the earlier one) and renormalises.
 * Used at generation time when a job's duration was shortened after its plan
 * was saved; the stored plan itself is never modified.
 */
export function fitAreasToDuration<T extends Pick<FocusArea, "coverageWeight" | "sortOrder">>(
  areas: T[],
  durationMinutes: unknown
): T[] {
  const maxAreas = maxFocusAreasForDuration(durationMinutes)
  const ordered = [...areas].sort((a, b) => a.sortOrder - b.sortOrder)
  if (ordered.length <= maxAreas) return ordered

  const keep = ordered
    .map((area, index) => ({ area, index }))
    .sort((a, b) => b.area.coverageWeight - a.area.coverageWeight || a.index - b.index)
    .slice(0, maxAreas)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.area)
  const weights = normalizeCoverageWeights(keep.map((area) => area.coverageWeight))

  return keep.map((area, index) => ({ ...area, coverageWeight: weights[index] }))
}
