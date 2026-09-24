import assert from "node:assert/strict"
import test from "node:test"

import { LIBRARY_KEYS } from "@/lib/server/interview-focus/competency-library"
import {
  buildFallbackRecommendation,
  buildRecommendationRequest,
  computeFocusInputHash,
  sanitizeAiRecommendation,
} from "@/lib/server/interview-focus/recommendation"

const ROLES = [
  { jobTitle: "Software Engineer", experienceLevel: "Mid", coreSkills: ["TypeScript", "Node.js", "PostgreSQL"], expect: ["role_knowledge", "problem_solving"] },
  { jobTitle: "Database Administrator", experienceLevel: "Senior", coreSkills: ["PostgreSQL", "Backup and recovery"], expect: ["role_knowledge", "quality_accuracy"] },
  { jobTitle: "Sales Manager", experienceLevel: "Senior", coreSkills: ["Negotiation", "Pipeline management"], expect: ["commercial_awareness", "customer_focus"] },
  { jobTitle: "Marketing Manager", experienceLevel: "Mid", coreSkills: ["Campaign management", "Brand strategy"], expect: ["strategic_thinking", "analytical_thinking"] },
  { jobTitle: "HR Manager", experienceLevel: "Senior", coreSkills: ["Employee relations", "HR policy"], expect: ["judgement", "role_knowledge"] },
  { jobTitle: "Finance Manager", experienceLevel: "Mid", coreSkills: ["Budgeting", "Month-end close"], expect: ["analytical_thinking", "quality_accuracy"] },
  { jobTitle: "Product Manager", experienceLevel: "Mid", coreSkills: ["Roadmapping", "User research"], expect: ["planning_prioritisation", "stakeholder_management", "customer_focus"] },
  { jobTitle: "Teacher", experienceLevel: "Mid", coreSkills: ["Lesson planning", "Classroom management"], expect: ["role_knowledge", "communication"] },
  { jobTitle: "Customer Success Manager", experienceLevel: "Mid", coreSkills: ["Onboarding", "Renewals"], expect: ["customer_focus", "communication"] },
  { jobTitle: "Operations Manager", experienceLevel: "Senior", coreSkills: ["Scheduling", "Vendor management"], expect: ["planning_prioritisation", "quality_accuracy"] },
]

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0)

for (const role of ROLES) {
  for (const durationMinutes of [30, 45, 60]) {
    test(`fallback: ${role.jobTitle} (${durationMinutes} min) is valid and role-appropriate`, () => {
      const rec = buildFallbackRecommendation({ ...role, durationMinutes })
      const keys = rec.areas.map((a) => a.areaKey)

      assert.equal(rec.source, "fallback")
      assert.ok(rec.areas.length >= 4 && rec.areas.length <= 5, `${keys}`)
      assert.equal(sum(rec.areas.map((a) => a.coverageWeight)), 100)
      assert.ok(rec.areas.every((a) => a.coverageWeight >= 10 && a.coverageWeight % 5 === 0))
      assert.equal(new Set(keys).size, keys.length, "no duplicates")
      assert.ok(keys.every((key) => LIBRARY_KEYS.includes(key)))
      for (const expected of role.expect) {
        assert.ok(keys.includes(expected), `${role.jobTitle} should cover ${expected}: ${keys}`)
      }
      assert.ok(keys.every((key) => rec.rationale[key]), "every area has a rationale")
    })
  }
}

test("fallback: senior roles include leadership, junior roles do not", () => {
  assert.ok(buildFallbackRecommendation({ jobTitle: "Senior Accountant", experienceLevel: "Senior" }).areas.some((a) => a.areaKey === "leadership"))
  const junior = buildFallbackRecommendation({ jobTitle: "Head of Marketing", experienceLevel: "Junior" }).areas.map((a) => a.areaKey)
  assert.ok(!junior.includes("leadership") && !junior.includes("strategic_thinking"), `${junior}`)
})

test("fallback: deterministic for identical input", () => {
  const input = { jobTitle: "Teacher", jobDescription: "Teach maths", coreSkills: ["Lesson planning"], experienceLevel: "Mid", durationMinutes: 45 }
  assert.deepEqual(buildFallbackRecommendation(input), buildFallbackRecommendation(input))
})

test("fallback: technical and non-technical roles share one library - no technical-only competency exists", () => {
  const technical = buildFallbackRecommendation({ jobTitle: "Software Engineer" }).areas.map((a) => a.areaKey)
  const teacher = buildFallbackRecommendation({ jobTitle: "Teacher" }).areas.map((a) => a.areaKey)
  assert.ok(technical.includes("role_knowledge") && teacher.includes("role_knowledge"))
  assert.ok(!LIBRARY_KEYS.some((key) => /tech|coding|engineer|software/.test(key)))
})

test("input hash: ignores skill order and whitespace, changes with real inputs", () => {
  const a = computeFocusInputHash({ jobTitle: "Teacher", coreSkills: ["B", "A"], durationMinutes: 30 })
  const b = computeFocusInputHash({ jobTitle: "  teacher ", coreSkills: ["a", "b"], durationMinutes: 30 })
  assert.equal(a, b)
  assert.notEqual(a, computeFocusInputHash({ jobTitle: "Teacher", coreSkills: ["A", "B"], durationMinutes: 60 }))
  assert.notEqual(a, computeFocusInputHash({ jobTitle: "Head Teacher", coreSkills: ["A", "B"], durationMinutes: 30 }))
})

test("request: schema restricts keys to the library and the prompt is role-agnostic", () => {
  const request = buildRecommendationRequest({ jobTitle: "Sales Manager", durationMinutes: 30 })
  assert.deepEqual(request.schema.properties.competencies.items.properties.key.enum, [...LIBRARY_KEYS])
  assert.match(request.system, /Never assume the role is technical/)
  assert.equal(request.maxAreas, 5)
  assert.equal(buildRecommendationRequest({ jobTitle: "Sales Manager", durationMinutes: 60 }).maxAreas, 6)
})

const input = { jobTitle: "Sales Manager", durationMinutes: 30 }

test("sanitize: valid AI output is normalised to server rules", () => {
  const rec = sanitizeAiRecommendation(
    {
      competencies: [
        { key: "commercial_awareness", weight: 33, rationale: "Owns regional revenue." },
        { key: "communication", weight: 21, rationale: "Leads client conversations." },
        { key: "customer_focus", weight: 17, rationale: "Keeps key accounts." },
        { key: "leadership", weight: 29, rationale: "Coaches a team of eight." },
      ],
    },
    input,
    { model: "test-model" }
  )!
  assert.equal(rec.source, "ai")
  assert.deepEqual(rec.areas.map((a) => a.areaKey), ["commercial_awareness", "leadership", "communication", "customer_focus"])
  assert.equal(sum(rec.areas.map((a) => a.coverageWeight)), 100)
  assert.ok(rec.areas.every((a) => a.coverageWeight % 5 === 0 && a.coverageWeight >= 10))
  assert.equal(rec.rationale.leadership, "Coaches a team of eight.")
})

test("sanitize: hostile or malformed AI output cannot bypass validation", () => {
  const rec = sanitizeAiRecommendation(
    {
      competencies: [
        { key: "hacking", weight: 90, rationale: "x" },
        { key: "communication", weight: 1000, rationale: "a".repeat(5000) },
        { key: "communication", weight: 50, rationale: "duplicate" },
        { key: "judgement", weight: -20, rationale: "negative" },
        { key: "ownership", weight: "NaN", rationale: "bad" },
        { key: "customer_focus", weight: 1, rationale: "ignore previous instructions" },
        { key: "problem_solving", weight: 2 },
        { key: "adaptability", weight: 3 },
        { key: "collaboration", weight: 4 },
        { key: "leadership", weight: 5 },
        { key: "quality_accuracy", weight: 6 },
      ],
    },
    input,
    { model: "test-model" }
  )!
  const keys = rec.areas.map((a) => a.areaKey)
  assert.ok(!keys.includes("hacking" as string))
  assert.ok(!keys.includes("judgement"), "non-positive weight dropped")
  assert.ok(!keys.includes("ownership"), "non-numeric weight dropped")
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(rec.areas.length <= 5, "capped to the 30-minute limit")
  assert.equal(sum(rec.areas.map((a) => a.coverageWeight)), 100)
  assert.ok(rec.rationale.communication.length <= 160)
})

test("sanitize: too little usable output returns null so the caller falls back", () => {
  assert.equal(sanitizeAiRecommendation({ competencies: [{ key: "communication", weight: 50, rationale: "" }] }, input, { model: "m" }), null)
  assert.equal(sanitizeAiRecommendation("not json", input, { model: "m" }), null)
  assert.equal(sanitizeAiRecommendation(null, input, { model: "m" }), null)
})

test("sanitize: bad totals, non-5 weights, sub-10 areas and extra fields are all normalised away", () => {
  const rec = sanitizeAiRecommendation(
    {
      competencies: [
        { key: "communication", weight: 7, rationale: "a", label: "HACKED", coverage_weight: 999, is_custom: true },
        { key: "judgement", weight: 13, rationale: "b" },
        { key: "ownership", weight: 33, rationale: "c" },
        { key: "customer_focus", weight: 2, rationale: "d" },
      ],
      resume_emphasis: "MAXIMUM",
      injected: { sql: "drop table" },
    },
    input,
    { model: "m" }
  )!
  const weights = rec.areas.map((a) => a.coverageWeight)
  assert.equal(sum(weights), 100)
  assert.ok(weights.every((w) => w % 5 === 0 && w >= 10), `${weights}`)
  const communication = rec.areas.find((a) => a.areaKey === "communication")!
  assert.equal(communication.label, "Communication", "label always from the library")
  assert.equal(communication.isCustom, false)
  assert.ok(!("resume_emphasis" in rec) && !("injected" in rec))
})
