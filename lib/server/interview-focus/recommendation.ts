/**
 * VERIS Recommended focus: the pure half of the recommendation engine.
 *
 *   - computeFocusInputHash      cache key over the job inputs that matter
 *   - buildFallbackRecommendation deterministic, used when AI is unavailable
 *   - buildRecommendationRequest  prompt + strict JSON schema for the AI call
 *   - sanitizeAiRecommendation    the ONLY way AI output becomes focus areas
 *
 * The network call itself lives in the interview-focus service. Whatever the
 * model returns is filtered to library keys, deduplicated, capped to the
 * duration limit and re-normalised to valid weights here; if too little
 * survives, the caller uses the deterministic fallback instead.
 *
 * Role-agnostic: families only choose which role-neutral competencies to
 * emphasise. "Role Knowledge & Expertise" carries all role-specific subject
 * matter for technical and non-technical roles alike.
 */

import { createHash } from "node:crypto"

import type { RoleFamily } from "@/lib/server/ai/skills"
import {
  COMPETENCY_LIBRARY,
  getCompetency,
  LIBRARY_KEYS,
} from "@/lib/server/interview-focus/competency-library"
import {
  cleanFocusText,
  maxFocusAreasForDuration,
  normalizeCoverageWeights,
  type FocusArea,
} from "@/lib/server/interview-focus/focus-rules"
import { resolveEmergencyRoleFamily } from "@/lib/server/interview/emergency-questions"
import { normalizeDurationMinutes, resolveSeniorityBand, type SeniorityBand } from "@/lib/server/interview/question-plan"

export const RECOMMENDATION_VERSION = 1
const MIN_AI_AREAS = 3
const MAX_RATIONALE_LENGTH = 160

export type FocusRecommendationInput = {
  jobTitle?: string | null
  jobDescription?: string | null
  coreSkills?: string[] | null
  experienceLevel?: string | null
  durationMinutes?: number | null
}

export type FocusRecommendation = {
  areas: FocusArea[]
  rationale: Record<string, string>
  source: "ai" | "fallback"
  inputHash: string
  roleFamily: string
  seniority: SeniorityBand
  model?: string
}

/**
 * Stable hash of the inputs a recommendation depends on. Order of skills and
 * whitespace do not matter; any change to title, JD, skills, level or the
 * duration band produces a new hash (and so a fresh recommendation).
 */
export function computeFocusInputHash(input: FocusRecommendationInput) {
  const normalized = {
    v: RECOMMENDATION_VERSION,
    title: cleanFocusText(input.jobTitle, 300).toLowerCase(),
    description: cleanFocusText(input.jobDescription, 20000).toLowerCase(),
    skills: (input.coreSkills ?? [])
      .map((skill) => cleanFocusText(skill, 200).toLowerCase())
      .filter(Boolean)
      .sort(),
    level: cleanFocusText(input.experienceLevel, 100).toLowerCase(),
    maxAreas: maxFocusAreasForDuration(normalizeDurationMinutes(input.durationMinutes)),
  }
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
}

type FamilyTemplate = { keys: string[] }

/** Five competencies per family, most important first. */
const FAMILY_TEMPLATES: Record<RoleFamily | "product", FamilyTemplate> = {
  technical: { keys: ["role_knowledge", "problem_solving", "quality_accuracy", "collaboration", "communication"] },
  operations: { keys: ["planning_prioritisation", "problem_solving", "quality_accuracy", "stakeholder_management", "ownership"] },
  sales: { keys: ["commercial_awareness", "communication", "customer_focus", "stakeholder_management", "ownership"] },
  customer_success: { keys: ["customer_focus", "communication", "problem_solving", "stakeholder_management", "ownership"] },
  hr: { keys: ["role_knowledge", "judgement", "communication", "stakeholder_management", "quality_accuracy"] },
  finance: { keys: ["role_knowledge", "analytical_thinking", "quality_accuracy", "communication", "planning_prioritisation"] },
  procurement: { keys: ["commercial_awareness", "stakeholder_management", "analytical_thinking", "quality_accuracy", "planning_prioritisation"] },
  marketing: { keys: ["strategic_thinking", "analytical_thinking", "communication", "customer_focus", "commercial_awareness"] },
  manufacturing_industrial: { keys: ["quality_accuracy", "problem_solving", "planning_prioritisation", "role_knowledge", "collaboration"] },
  construction_site: { keys: ["planning_prioritisation", "quality_accuracy", "stakeholder_management", "problem_solving", "role_knowledge"] },
  legal_compliance: { keys: ["role_knowledge", "judgement", "quality_accuracy", "analytical_thinking", "communication"] },
  healthcare: { keys: ["role_knowledge", "customer_focus", "judgement", "communication", "quality_accuracy"] },
  education_training: { keys: ["role_knowledge", "communication", "planning_prioritisation", "adaptability", "judgement"] },
  logistics_warehouse_fleet: { keys: ["planning_prioritisation", "problem_solving", "quality_accuracy", "collaboration", "ownership"] },
  creative_design_content: { keys: ["role_knowledge", "strategic_thinking", "communication", "stakeholder_management", "adaptability"] },
  bpo_call_center: { keys: ["customer_focus", "communication", "problem_solving", "quality_accuracy", "adaptability"] },
  banking_financial_services: { keys: ["role_knowledge", "quality_accuracy", "customer_focus", "analytical_thinking", "judgement"] },
  leadership_management: { keys: ["leadership", "strategic_thinking", "stakeholder_management", "judgement", "communication"] },
  general_business: { keys: ["role_knowledge", "problem_solving", "communication", "planning_prioritisation", "ownership"] },
  // Not a classifier family: product roles otherwise fall into leadership.
  product: { keys: ["strategic_thinking", "planning_prioritisation", "stakeholder_management", "customer_focus", "analytical_thinking"] },
}

/** Base weights for a template, most important first. */
const TEMPLATE_WEIGHTS = [30, 25, 20, 15, 10]

const PRODUCT_TITLE = /\b(product (manager|owner|lead|director)|head of product|product management)\b/i

function resolveTemplateFamily(input: FocusRecommendationInput): RoleFamily | "product" {
  if (PRODUCT_TITLE.test(String(input.jobTitle ?? ""))) return "product"
  return resolveEmergencyRoleFamily({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    coreSkills: input.coreSkills,
  })
}

function applySeniority(keys: string[], seniority: SeniorityBand) {
  const next = [...keys]

  if (seniority === "senior" && !next.includes("leadership")) {
    next[next.length - 1] = "leadership"
  }

  if (seniority === "junior") {
    for (const senior of ["leadership", "strategic_thinking"]) {
      const index = next.indexOf(senior)
      if (index === -1) continue
      const replacement = ["adaptability", "ownership", "collaboration"].find((key) => !next.includes(key))
      if (replacement) next[index] = replacement
    }
  }

  return next
}

function toFocusAreas(keys: string[], weights: number[]): FocusArea[] {
  return keys.map((key, index) => {
    const entry = getCompetency(key)!
    return {
      areaKey: entry.key,
      label: entry.label,
      description: entry.description,
      isCustom: false,
      sortOrder: index + 1,
      coverageWeight: weights[index],
    }
  })
}

export function buildFallbackRecommendation(input: FocusRecommendationInput): FocusRecommendation {
  const family = resolveTemplateFamily(input)
  const seniority = resolveSeniorityBand(input.experienceLevel || input.jobTitle)
  const maxAreas = maxFocusAreasForDuration(normalizeDurationMinutes(input.durationMinutes))
  const keys = applySeniority(FAMILY_TEMPLATES[family].keys, seniority).slice(0, maxAreas)
  const weights = normalizeCoverageWeights(TEMPLATE_WEIGHTS.slice(0, keys.length))

  return {
    areas: toFocusAreas(keys, weights),
    rationale: Object.fromEntries(keys.map((key) => [key, getCompetency(key)!.defaultRationale])),
    source: "fallback",
    inputHash: computeFocusInputHash(input),
    roleFamily: family,
    seniority,
  }
}

export function buildRecommendationRequest(input: FocusRecommendationInput) {
  const maxAreas = maxFocusAreasForDuration(normalizeDurationMinutes(input.durationMinutes))
  const targetMax = Math.min(6, maxAreas)

  const system = [
    "You recommend the competency focus for a structured job interview.",
    "You work across every industry and profession: healthcare, education, sales, finance, operations, hospitality, public sector, trades, technology and any other field.",
    "",
    "Choose ONLY from the supplied competency library. Never invent competencies.",
    "Infer what matters most for this role from the job data alone. Never assume the role is technical.",
    '"role_knowledge" covers all role-specific subject matter (clinical, commercial, legal, technical or otherwise); do not treat any other competency as a technical skill.',
    "Prefer competencies the job data gives clear evidence for. Reflect seniority: leadership and strategy matter more for senior roles, learning and execution for junior ones.",
    "",
    `Select between 4 and ${targetMax} competencies. Give each an integer weight; weights should reflect relative importance and will be normalised to total 100.`,
    "For each, give a rationale of at most 20 words that refers to this specific job.",
    "Return JSON only, matching the schema.",
  ].join("\n")

  const user = JSON.stringify(
    {
      role_title: cleanFocusText(input.jobTitle, 300) || "Not supplied",
      job_description: cleanFocusText(input.jobDescription, 6000) || "Not supplied",
      required_skills: (input.coreSkills ?? []).map((skill) => cleanFocusText(skill, 120)).filter(Boolean).slice(0, 40),
      experience_level: cleanFocusText(input.experienceLevel, 100) || "Not supplied",
      maximum_competencies: targetMax,
      competency_library: COMPETENCY_LIBRARY.map((entry) => ({
        key: entry.key,
        label: entry.label,
        description: entry.description,
      })),
    },
    null,
    2
  )

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["competencies"],
    properties: {
      competencies: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "weight", "rationale"],
          properties: {
            key: { type: "string", enum: [...LIBRARY_KEYS] },
            weight: { type: "integer" },
            rationale: { type: "string" },
          },
        },
      },
    },
  } as const

  return { system, user, schema, maxAreas: targetMax }
}

/**
 * Converts raw model output into valid focus areas, or null when too little
 * of it is usable. Unknown keys, duplicates, non-positive weights and excess
 * entries are dropped; weights are re-normalised to 5% steps summing to 100
 * with a 10% floor. The model's own numbers are only ever a relative signal.
 */
export function sanitizeAiRecommendation(
  raw: unknown,
  input: FocusRecommendationInput,
  meta: { model: string }
): FocusRecommendation | null {
  const maxAreas = Math.min(6, maxFocusAreasForDuration(normalizeDurationMinutes(input.durationMinutes)))
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { competencies?: unknown }).competencies)
      ? ((raw as { competencies: unknown[] }).competencies)
      : []

  const seen = new Set<string>()
  const picked: Array<{ key: string; weight: number; rationale: string }> = []

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const key = String(record.key ?? "")
    const weight = Number(record.weight)
    if (!getCompetency(key) || seen.has(key)) continue
    if (!Number.isFinite(weight) || weight <= 0) continue
    seen.add(key)
    picked.push({
      key,
      weight,
      rationale: cleanFocusText(record.rationale, MAX_RATIONALE_LENGTH) || getCompetency(key)!.defaultRationale,
    })
  }

  // Most important first; ties keep the model's order.
  const ranked = picked
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .slice(0, maxAreas)

  if (ranked.length < MIN_AI_AREAS) return null

  const weights = normalizeCoverageWeights(ranked.map((entry) => entry.weight))
  const keys = ranked.map((entry) => entry.key)

  return {
    areas: toFocusAreas(keys, weights),
    rationale: Object.fromEntries(ranked.map((entry) => [entry.key, entry.rationale])),
    source: "ai",
    inputHash: computeFocusInputHash(input),
    roleFamily: resolveTemplateFamily(input),
    seniority: resolveSeniorityBand(input.experienceLevel || input.jobTitle),
    model: meta.model,
  }
}
