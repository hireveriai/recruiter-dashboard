import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_AI_FEEDBACK_GENERATION_LIMIT,
  DEFAULT_AI_GENERATION_LIMIT,
  feedbackGenerationLimitInfo,
  feedbackGenerationLimitReachedError,
  generationLimitInfo,
  generationLimitReachedError,
} from "@/lib/server/ai-generation-limit"

test("default limit is 3", () => {
  assert.equal(DEFAULT_AI_GENERATION_LIMIT, 3)
})

test("generation #1 (the initial generation) leaves 2 remaining and allows more", () => {
  assert.deepEqual(generationLimitInfo(1), {
    generationLimit: 3,
    generationAttempts: 1,
    remainingGenerations: 2,
    canGenerate: true,
  })
})

test("generation #3 leaves 0 remaining but canGenerate is still false only once attempts hit the limit", () => {
  assert.deepEqual(generationLimitInfo(3), {
    generationLimit: 3,
    generationAttempts: 3,
    remainingGenerations: 0,
    canGenerate: false,
  })
})

test("a fourth attempt is blocked", () => {
  const info = generationLimitInfo(4)
  assert.equal(info.canGenerate, false)
  assert.equal(info.remainingGenerations, 0, "remaining never goes negative")
})

test("a brand new draft (0 attempts) has the full allowance available", () => {
  assert.deepEqual(generationLimitInfo(0), {
    generationLimit: 3,
    generationAttempts: 0,
    remainingGenerations: 3,
    canGenerate: true,
  })
})

test("generationLimitReachedError is a 409 with a structured, non-alarming payload", () => {
  const error = generationLimitReachedError(3)
  assert.equal(error.statusCode, 409)
  assert.equal(error.code, "AI_GENERATION_LIMIT_REACHED")
  assert.deepEqual(error.details, {
    generationLimit: 3,
    generationAttempts: 3,
    remainingGenerations: 0,
    canGenerate: false,
  })
  assert.match(error.message, /manually/i)
})

test("a custom limit is respected end to end", () => {
  assert.deepEqual(generationLimitInfo(2, 5), {
    generationLimit: 5,
    generationAttempts: 2,
    remainingGenerations: 3,
    canGenerate: true,
  })
})

test("default feedback generation limit is 3, independent of the question-generation limit", () => {
  assert.equal(DEFAULT_AI_FEEDBACK_GENERATION_LIMIT, 3)
})

test("feedback generation #1 (the initial generation) leaves 2 remaining and allows more", () => {
  assert.deepEqual(feedbackGenerationLimitInfo(1), {
    feedbackGenerationLimit: 3,
    feedbackGenerationAttempts: 1,
    remainingFeedbackGenerations: 2,
    canRegenerateFeedback: true,
  })
})

test("feedback generation #3 (second regeneration) uses up the allowance", () => {
  assert.deepEqual(feedbackGenerationLimitInfo(3), {
    feedbackGenerationLimit: 3,
    feedbackGenerationAttempts: 3,
    remainingFeedbackGenerations: 0,
    canRegenerateFeedback: false,
  })
})

test("a 4th feedback generation is blocked and remaining never goes negative", () => {
  const info = feedbackGenerationLimitInfo(4)
  assert.equal(info.canRegenerateFeedback, false)
  assert.equal(info.remainingFeedbackGenerations, 0)
})

test("feedbackGenerationLimitReachedError is a 409 with a distinct code from the question-generation limit", () => {
  const error = feedbackGenerationLimitReachedError(3)
  assert.equal(error.statusCode, 409)
  assert.equal(error.code, "AI_FEEDBACK_GENERATION_LIMIT_REACHED")
  assert.notEqual(error.code, "AI_GENERATION_LIMIT_REACHED")
  assert.deepEqual(error.details, {
    feedbackGenerationLimit: 3,
    feedbackGenerationAttempts: 3,
    remainingFeedbackGenerations: 0,
    canRegenerateFeedback: false,
  })
  assert.match(error.message, /recruiter notes/i)
})
