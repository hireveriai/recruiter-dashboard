import assert from "node:assert/strict"
import test from "node:test"

import { validateQuestionStrict } from "@/lib/server/ai/question-validator"
import { getFallbackSkillsForRoleFamily, presentSkillName } from "@/lib/server/ai/skills"
import {
  buildEmergencyQuestionText,
  resolveEmergencyRoleFamily,
} from "@/lib/server/interview/emergency-questions"

const ROLES = [
  { jobTitle: "Software Engineer", coreSkills: ["TypeScript", "Node.js", "PostgreSQL"], family: "technical" },
  { jobTitle: "Database Administrator", coreSkills: ["PostgreSQL", "Backup and recovery"], family: "technical" },
  { jobTitle: "Sales Manager", coreSkills: ["Negotiation", "Pipeline management"], family: "sales" },
  { jobTitle: "Marketing Manager", coreSkills: ["Campaign management", "Brand strategy"], family: "marketing" },
  { jobTitle: "HR Manager", coreSkills: ["Employee relations", "Performance management"], family: "hr" },
  { jobTitle: "Finance Manager", coreSkills: ["Budgeting", "Financial reporting"], family: "finance" },
  { jobTitle: "Product Manager", coreSkills: ["Roadmapping", "Prioritisation"], family: "leadership_management" },
  { jobTitle: "Teacher", coreSkills: ["Lesson planning", "Classroom management"], family: "education_training" },
  { jobTitle: "Customer Success Manager", coreSkills: ["Customer onboarding", "Renewals"], family: "customer_success" },
  { jobTitle: "Operations Manager", coreSkills: ["Scheduling", "Vendor management"], family: "operations" },
] as const

const TECHNICAL_WORDING =
  /\b(production|debug|deploy|releasing|release|sql|code|coding|programming|outage|incident|at scale|reliability|diagnose a failure)\b/i

test("emergency: role family follows the job title for the required roles", () => {
  for (const role of ROLES) {
    assert.equal(
      resolveEmergencyRoleFamily({ jobTitle: role.jobTitle, coreSkills: [...role.coreSkills] }),
      role.family,
      role.jobTitle
    )
  }
})

test("emergency: DBA abbreviations and technical titles stay technical", () => {
  assert.equal(resolveEmergencyRoleFamily({ jobTitle: "Senior DBA" }), "technical")
  assert.equal(resolveEmergencyRoleFamily({ jobTitle: "Backend Developer" }), "technical")
})

test("emergency: a technical word does not turn a non-technical function technical", () => {
  assert.equal(resolveEmergencyRoleFamily({ jobTitle: "Software Sales Manager" }), "sales")
  assert.equal(resolveEmergencyRoleFamily({ jobTitle: "Technical Recruiter" }), "hr")
})

test("emergency: a vague title falls back to the JD and skills", () => {
  assert.equal(
    resolveEmergencyRoleFamily({
      jobTitle: "Associate",
      jobDescription: "Support patients and coordinate care with the clinical team in a hospital ward.",
      coreSkills: ["Patient care"],
    }),
    "healthcare"
  )
})

test("emergency: non-technical roles never get technical wording", () => {
  for (const role of ROLES.filter((entry) => entry.family !== "technical")) {
    const skills = [...role.coreSkills, ...getFallbackSkillsForRoleFamily(role.family)]
    for (let index = 0; index < 15; index += 1) {
      const question = buildEmergencyQuestionText({
        skill: presentSkillName(skills[index % skills.length]),
        index,
        family: role.family,
      })
      assert.doesNotMatch(question, TECHNICAL_WORDING, `${role.jobTitle}: ${question}`)
    }
  }
})

test("emergency: every generated question passes strict validation for every family", () => {
  const families = [
    "technical", "operations", "sales", "customer_success", "hr", "finance", "procurement",
    "marketing", "manufacturing_industrial", "construction_site", "legal_compliance", "healthcare",
    "education_training", "logistics_warehouse_fleet", "creative_design_content", "bpo_call_center",
    "banking_financial_services", "leadership_management", "general_business",
  ] as const

  for (const family of families) {
    for (const skill of getFallbackSkillsForRoleFamily(family)) {
      for (let index = 0; index < 7; index += 1) {
        const question = buildEmergencyQuestionText({ skill: presentSkillName(skill), index, family })
        const result = validateQuestionStrict(question)
        assert.ok(result.valid, `${family}: "${question}" -> ${result.reason}`)
      }
    }
  }
})

test("emergency: technical roles keep the original technical templates", () => {
  assert.equal(
    buildEmergencyQuestionText({ skill: "PostgreSQL", index: 0, family: "technical" }),
    "How would you diagnose a failure involving PostgreSQL under production pressure?"
  )
  assert.equal(
    buildEmergencyQuestionText({ skill: "PostgreSQL", index: 4, family: "technical" }),
    "How would you improve the reliability of PostgreSQL after a recurring incident?"
  )
})

test("emergency: questions are deterministic", () => {
  const input = { skill: "Lesson planning", index: 3, family: "education_training" as const }
  assert.equal(buildEmergencyQuestionText(input), buildEmergencyQuestionText(input))
  assert.equal(
    resolveEmergencyRoleFamily({ jobTitle: "Teacher" }),
    resolveEmergencyRoleFamily({ jobTitle: "Teacher" })
  )
})
