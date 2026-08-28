import assert from "node:assert/strict"
import test from "node:test"

import { validateQuestionStrict } from "@/lib/server/ai/question-validator"

test("accepts good questions from unrelated industries", () => {
  const questions = [
    "How do you de-escalate a patient who is refusing treatment?",
    "Walk me through closing the month end ledger under a tight deadline",
    "What would you do if a shipment missed its delivery window?",
    "Describe how you handle a guest complaint during a full service",
    "Why would you escalate a safeguarding concern rather than resolve it?",
    "How do you plan a lesson when half the class is behind?",
    "Explain how you decide which cases to prioritise on a busy shift",
    "How would you diagnose a failure in the deployment pipeline?",
  ]

  for (const question of questions) {
    const result = validateQuestionStrict(question)
    assert.equal(result.valid, true, `rejected "${question}" as ${result.reason}`)
  }
})

test("no longer rejects non-coding question openings", () => {
  // These were all rejected as bad_format by the previous validator.
  for (const question of [
    "Describe a time you rebuilt trust with an unhappy client",
    "Why did you choose that approach over the alternative?",
    "Tell me how you prepare for a difficult negotiation",
    "When would you involve a supervisor in a dispute?",
  ]) {
    assert.equal(validateQuestionStrict(question).valid, true, question)
  }
})

test("accepts auxiliary-verb question forms", () => {
  // Regression: these were rejected as bad_format, silently discarding a
  // question the model had correctly produced.
  for (const question of [
    "Can you describe your approach to maintaining stock integrity overnight?",
    "Could you walk me through handling a late delivery to a key customer?",
    "Have you had to challenge a colleague about a safety concern?",
    "Would you escalate a staffing shortfall before or after the shift starts?",
    "Did you ever have to reverse a decision you had already announced?",
  ]) {
    const result = validateQuestionStrict(question)
    assert.equal(result.valid, true, `rejected "${question}" as ${result.reason}`)
  }
})

test("rejects questions that leak the source documents", () => {
  assert.equal(validateQuestionStrict("You highlighted payroll work so how did you manage it?").reason, "source_leak")
  assert.equal(validateQuestionStrict("According to your resume how did you run that project?").reason, "source_leak")
  assert.equal(validateQuestionStrict("The job description says you manage budgets so how?").reason, "source_leak")
})

test("rejects vague or unscoreable prompts", () => {
  assert.equal(validateQuestionStrict("Tell me about yourself and your career so far").reason, "vague")
  assert.equal(validateQuestionStrict("What are your strengths as a team member here?").reason, "vague")
  assert.equal(validateQuestionStrict("How do you handle problems in this role generally?").reason, "vague")
})

test("enforces length bounds", () => {
  assert.equal(validateQuestionStrict("How do you cope?").reason, "too_short")
  assert.equal(validateQuestionStrict("").reason, "empty")
  const tooLong = `How would you ${"handle a difficult situation ".repeat(8)}?`
  assert.equal(validateQuestionStrict(tooLong).reason, "too_long")
})

test("rejects stacked clauses and multi-question prompts", () => {
  assert.equal(
    validateQuestionStrict("How do you plan, execute, review, and report on a campaign?").reason,
    "multi_clause"
  )
  assert.equal(
    validateQuestionStrict("How do you prioritise work? What tools help you do that?").reason,
    "multi_question"
  )
})

test("allows a short scenario preamble with one comma", () => {
  assert.equal(
    validateQuestionStrict("When two clients escalate at once, how do you decide who comes first?").valid,
    true
  )
})

test("does not encode any profession in its accept criteria", () => {
  // The same sentence shape must pass regardless of the field it references.
  const shape = (subject: string) => `How do you maintain accuracy in ${subject} under time pressure?`
  for (const subject of ["patient records", "tax filings", "stock counts", "database backups", "lesson plans"]) {
    assert.equal(validateQuestionStrict(shape(subject)).valid, true, subject)
  }
})
