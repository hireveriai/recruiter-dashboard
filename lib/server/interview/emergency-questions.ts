/**
 * Deterministic last-resort interview questions.
 *
 * Used only when AI question preparation has failed every retry. They must
 * still suit the actual role: the previous fallback collapsed every role into
 * "technical" or a back-office "business" set (records, cases, escalations),
 * which does not fit teachers, sales, nurses, marketing, product or finance.
 *
 * Role family is resolved from the job title first, then the full job context
 * (JD and core skills), using the existing role-family classifier. Technical
 * roles keep their original templates unchanged.
 *
 * Pure and deterministic: no I/O, no AI.
 */

import { inferRoleIntelligence, type RoleFamily } from "@/lib/server/ai/skills"

export type EmergencyRoleInput = {
  jobTitle?: string | null
  jobDescription?: string | null
  coreSkills?: string[] | null
}

/**
 * Non-technical functions named in a title. When one appears next to a
 * technical word ("Software Sales Manager", "Technical Recruiter") the
 * function decides the family, not the incidental technical word.
 */
const TITLE_FUNCTION_PATTERN =
  /\b(sales|marketing|recruit\w*|talent|hr|human resources|teacher|tutor|lecturer|finance|financial|accountant|accounting|customer|nurse|nursing)\b/i

/** Technical words that can decorate a non-technical title. */
const TITLE_TECH_DECORATION_PATTERN = /\b(software|technical|technology|tech|it|saas|cloud|digital)\b/gi

/** Title terms the keyword classifier does not recognise on its own. */
const TECHNICAL_TITLE_PATTERN = /\b(dba|sre|sdet|sysadmin)\b/i

function cleanTitle(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

/**
 * Title first, then the whole job. Falls back to the combined job context only
 * when the title alone says nothing specific.
 */
export function resolveEmergencyRoleFamily(input: EmergencyRoleInput): RoleFamily {
  const title = cleanTitle(input.jobTitle)

  if (title) {
    if (TECHNICAL_TITLE_PATTERN.test(title)) {
      return "technical"
    }

    let family = inferRoleIntelligence({ jobTitle: title }).family

    if (family === "technical" && TITLE_FUNCTION_PATTERN.test(title)) {
      const withoutDecoration = cleanTitle(title.replace(TITLE_TECH_DECORATION_PATTERN, " "))
      family = inferRoleIntelligence({ jobTitle: withoutDecoration }).family
    }

    if (family !== "general_business") {
      return family
    }
  }

  return inferRoleIntelligence({
    jobTitle: title || undefined,
    jobDescription: input.jobDescription ?? undefined,
    coreSkills: input.coreSkills ?? [],
  }).family
}

/**
 * A short everyday work situation per family. Kept deliberately generic; the
 * skill anchor supplies the role-specific subject matter.
 */
const FAMILY_WORK_CONTEXT: Record<RoleFamily, string> = {
  technical: "a system you owned",
  operations: "a daily operation",
  sales: "a customer deal",
  customer_success: "a customer account",
  hr: "an employee situation",
  finance: "a budget or report",
  procurement: "a supplier or purchase",
  marketing: "a campaign or launch",
  manufacturing_industrial: "a production shift",
  construction_site: "a site schedule",
  legal_compliance: "a compliance matter",
  healthcare: "patient care",
  education_training: "a class of learners",
  logistics_warehouse_fleet: "a shipment or route",
  creative_design_content: "a creative brief",
  bpo_call_center: "a customer call",
  banking_financial_services: "a client account",
  leadership_management: "your team",
  general_business: "your daily work",
}

/** Original technical templates, unchanged. */
const TECHNICAL_TEMPLATES = [
  (skill: string) => `How would you diagnose a failure involving ${skill} under production pressure?`,
  (skill: string) => `Walk me through a difficult ${skill} decision and how you validated it.`,
  (skill: string) => `How do you test ${skill} changes before releasing them?`,
  (skill: string) => `What trade-offs guide your approach to ${skill} at scale?`,
  (skill: string) => `How would you improve the reliability of ${skill} after a recurring incident?`,
]

/**
 * Role-neutral templates. Each must pass validateQuestionStrict: an accepted
 * opening, 6-26 words, at most two commas and one question mark.
 */
const ROLE_NEUTRAL_TEMPLATES = [
  (skill: string, context: string) => `Walk me through a time ${skill} became difficult while handling ${context}. What did you do?`,
  (skill: string, context: string) => `How do you prioritise ${skill} when competing deadlines affect ${context}?`,
  (skill: string, context: string) => `What do you do first when ${skill} is not going to plan for ${context}?`,
  (skill: string, context: string) => `How do you keep people aligned on ${skill} when priorities for ${context} conflict?`,
  (skill: string) => `How do you check the quality of your ${skill} work before it reaches others?`,
  (skill: string, context: string) => `How would you improve an inefficient approach to ${skill} without disrupting ${context}?`,
  (skill: string) => `Which measures tell you your ${skill} is working well, and what do you adjust when it is not?`,
]

export function isTechnicalRoleFamily(family: RoleFamily | string) {
  return family === "technical"
}

export function buildEmergencyQuestionText(params: {
  skill: string
  index: number
  family: RoleFamily
}) {
  const skill = cleanTitle(params.skill) || "your core responsibilities"
  const index = Math.max(0, Math.floor(params.index))

  if (isTechnicalRoleFamily(params.family)) {
    return TECHNICAL_TEMPLATES[index % TECHNICAL_TEMPLATES.length](skill)
  }

  const context = FAMILY_WORK_CONTEXT[params.family] ?? FAMILY_WORK_CONTEXT.general_business
  return ROLE_NEUTRAL_TEMPLATES[index % ROLE_NEUTRAL_TEMPLATES.length](skill, context)
}
