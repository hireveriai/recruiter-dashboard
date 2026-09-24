import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeDurationMinutes,
  resolveInterviewQuestionPlan,
  resolveQuestionBudget,
  resolveQuestionDistribution,
  resolveSeniorityBand,
} from "@/lib/server/interview/question-plan"

test("budget matches the interview engine's own scale", () => {
  assert.equal(resolveQuestionBudget(30).totalQuestions, 8)
  assert.equal(resolveQuestionBudget(45).totalQuestions, 12)
  assert.equal(resolveQuestionBudget(60).totalQuestions, 15)
})

test("budget uses the longest band the duration satisfies", () => {
  assert.equal(resolveQuestionBudget(90).totalQuestions, 15)
  assert.equal(resolveQuestionBudget(59).totalQuestions, 12)
  assert.equal(resolveQuestionBudget(44).totalQuestions, 8)
  assert.equal(resolveQuestionBudget(29).totalQuestions, 4)
})

test("short and invalid durations fall back safely", () => {
  assert.equal(resolveQuestionBudget(5).totalQuestions, 4)
  assert.equal(resolveQuestionBudget(0).totalQuestions, 8, "0 is treated as the 30 minute default")
  assert.equal(resolveQuestionBudget(null).totalQuestions, 8)
  assert.equal(resolveQuestionBudget("not-a-number").totalQuestions, 8)
})

test("normalizeDurationMinutes defaults rather than throwing", () => {
  assert.equal(normalizeDurationMinutes(45), 45)
  assert.equal(normalizeDurationMinutes(-10), 30)
  assert.equal(normalizeDurationMinutes(undefined), 30)
  assert.equal(normalizeDurationMinutes(45.9), 45)
})

test("seniority band is inferred without assuming any profession", () => {
  assert.equal(resolveSeniorityBand("Senior Account Manager"), "senior")
  assert.equal(resolveSeniorityBand("Junior Paralegal"), "junior")
  assert.equal(resolveSeniorityBand("Registered Nurse"), "mid")
  assert.equal(resolveSeniorityBand("Head of Catering"), "senior")
  assert.equal(resolveSeniorityBand("apprentice electrician"), "junior")
  assert.equal(resolveSeniorityBand(""), "mid")
  assert.equal(resolveSeniorityBand(undefined), "mid")
})

test("distribution always sums to the total", () => {
  for (const duration of [10, 30, 45, 60]) {
    for (const seniority of ["junior", "mid", "senior"] as const) {
      for (const resumeQuestionsEnabled of [true, false]) {
        const budget = resolveQuestionBudget(duration)
        const distribution = resolveQuestionDistribution({
          totalQuestions: budget.totalQuestions,
          seniority,
          resumeQuestionsEnabled,
        })
        const sum =
          distribution.job + distribution.experience + distribution.behavioral + distribution.resume
        assert.equal(
          sum,
          budget.totalQuestions,
          `${duration}min/${seniority}/resume=${resumeQuestionsEnabled} summed to ${sum}`
        )
      }
    }
  }
})

test("disabling resume questions yields a fully shared core", () => {
  const plan = resolveInterviewQuestionPlan({
    durationMinutes: 45,
    experienceLevel: "Mid",
    resumeQuestionsEnabled: false,
  })

  assert.equal(plan.resumeQuestionCount, 0)
  assert.equal(plan.structuredQuestionCount, plan.totalQuestions)
})

test("resume questions are capped so the shared core stays dominant", () => {
  const plan = resolveInterviewQuestionPlan({
    durationMinutes: 60,
    experienceLevel: "Junior Support Associate",
    resumeQuestionsEnabled: true,
  })

  assert.ok(plan.resumeQuestionCount <= 2, `expected <= 2, got ${plan.resumeQuestionCount}`)
  assert.ok(plan.structuredQuestionCount > plan.resumeQuestionCount)
})

test("plan is deterministic for identical input", () => {
  const args = { durationMinutes: 30, experienceLevel: "Senior Logistics Coordinator", resumeQuestionsEnabled: true }
  assert.deepEqual(resolveInterviewQuestionPlan(args), resolveInterviewQuestionPlan(args))
})

test("resume questions default to enabled when unspecified", () => {
  const plan = resolveInterviewQuestionPlan({ durationMinutes: 60, experienceLevel: "Mid" })
  assert.equal(plan.resumeQuestionsEnabled, true)
})

test("plan works identically across unrelated industries", () => {
  const roles = [
    "Senior Registered Nurse",
    "Senior Financial Controller",
    "Senior Warehouse Supervisor",
    "Senior Software Engineer",
    "Senior Schoolteacher",
  ]
  const plans = roles.map((role) =>
    resolveInterviewQuestionPlan({ durationMinutes: 45, experienceLevel: role, resumeQuestionsEnabled: true })
  )

  for (const plan of plans) {
    assert.deepEqual(plan.distribution, plans[0].distribution, "role must not change the plan")
  }
})

test("resume emphasis: absent and STANDARD are identical to the existing plan", () => {
  for (const durationMinutes of [30, 45, 60]) {
    for (const experienceLevel of ["Junior", "Mid", "Senior"]) {
      const legacy = resolveInterviewQuestionPlan({ durationMinutes, experienceLevel })
      assert.deepEqual(resolveInterviewQuestionPlan({ durationMinutes, experienceLevel, resumeEmphasis: "STANDARD" }), legacy)
      assert.deepEqual(resolveInterviewQuestionPlan({ durationMinutes, experienceLevel, resumeEmphasis: null }), legacy)
    }
  }
})

test("resume emphasis: OFF, LIGHT and HEAVY change only the resume share, never the total", () => {
  for (const durationMinutes of [30, 45, 60]) {
    const standard = resolveInterviewQuestionPlan({ durationMinutes, experienceLevel: "Mid" })
    const off = resolveInterviewQuestionPlan({ durationMinutes, experienceLevel: "Mid", resumeEmphasis: "OFF" })
    const light = resolveInterviewQuestionPlan({ durationMinutes, experienceLevel: "Mid", resumeEmphasis: "LIGHT" })
    const heavy = resolveInterviewQuestionPlan({ durationMinutes, experienceLevel: "Mid", resumeEmphasis: "HEAVY" })

    for (const plan of [off, light, heavy]) {
      assert.equal(plan.totalQuestions, standard.totalQuestions, `${durationMinutes} min total unchanged`)
      assert.equal(plan.structuredQuestionCount + plan.resumeQuestionCount, standard.totalQuestions)
    }
    assert.equal(off.resumeQuestionCount, 0)
    assert.equal(off.resumeQuestionsEnabled, false)
    assert.equal(light.resumeQuestionCount, 1)
    assert.ok(heavy.resumeQuestionCount > standard.resumeQuestionCount)
    assert.ok(heavy.resumeQuestionCount <= 4)
  }
  assert.equal(resolveInterviewQuestionPlan({ durationMinutes: 30, resumeEmphasis: "HEAVY" }).resumeQuestionCount, 3)
  assert.equal(resolveInterviewQuestionPlan({ durationMinutes: 60, resumeEmphasis: "HEAVY" }).resumeQuestionCount, 4)
})

test("resume emphasis cannot override a job that has resume questions turned off", () => {
  const plan = resolveInterviewQuestionPlan({ durationMinutes: 60, resumeQuestionsEnabled: false, resumeEmphasis: "HEAVY" })
  assert.equal(plan.resumeQuestionCount, 0)
})
