import assert from "node:assert/strict"
import test from "node:test"

import { deriveInterviewStatus } from "@/lib/server/services/interview-status"

test("completed interview status wins over an abandoned latest attempt", () => {
  const status = deriveInterviewStatus({
    interviewStatus: "COMPLETED",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "ABANDONED",
      endedAt: new Date(),
    },
  })

  assert.equal(status, "COMPLETED")
})

test("abandoned attempt stays abandoned when the interview is not completed", () => {
  const status = deriveInterviewStatus({
    interviewStatus: "READY",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "ABANDONED",
      endedAt: new Date(),
    },
  })

  assert.equal(status, "ABANDONED")
})

test("answered required questions win over interrupted attempt status", () => {
  const status = deriveInterviewStatus({
    interviewStatus: "READY",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "INTERRUPTED",
      requiredQuestionCount: 10,
      answeredQuestionCount: 10,
    },
  })

  assert.equal(status, "COMPLETED")
})

test("answered required questions win over abandoned attempt status", () => {
  const status = deriveInterviewStatus({
    interviewStatus: "READY",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "ABANDONED",
      requiredQuestionCount: 10,
      answeredQuestionCount: 10,
    },
  })

  assert.equal(status, "COMPLETED")
})
