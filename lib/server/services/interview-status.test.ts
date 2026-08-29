import assert from "node:assert/strict"
import test from "node:test"

import { deriveInterviewStatus } from "@/lib/server/services/interview-status"

test("an abandoned attempt is not laundered into COMPLETED by a stale interview status", () => {
  // The backend used to write COMPLETED onto the parent interview regardless of
  // the attempt's real outcome, and this derivation trusted that field first.
  // A session the platform dropped must never read as a finished interview.
  const status = deriveInterviewStatus({
    interviewStatus: "COMPLETED",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "ABANDONED",
      endedAt: new Date(),
    },
  })

  assert.equal(status, "NEEDS_REVIEW")
})

test("abandoned attempt needs review when the interview is not completed", () => {
  const status = deriveInterviewStatus({
    interviewStatus: "READY",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "ABANDONED",
      endedAt: new Date(),
    },
  })

  assert.equal(status, "NEEDS_REVIEW")
})

test("an unrepaired transcript needs review even when the interview says COMPLETED", () => {
  const status = deriveInterviewStatus({
    interviewStatus: "COMPLETED",
    finalStatus: "TRANSCRIPT_REVIEW_REQUIRED",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "COMPLETED",
      endedAt: new Date(),
    },
  })

  assert.equal(status, "NEEDS_REVIEW")
})

test("a NEEDS_REVIEW interview status is surfaced directly", () => {
  const status = deriveInterviewStatus({
    interviewStatus: "NEEDS_REVIEW",
    finalStatus: "ABANDONED",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "ABANDONED",
      endedAt: new Date(),
    },
  })

  assert.equal(status, "NEEDS_REVIEW")
})

test("an early exit that answered nothing near the full set needs review", () => {
  // Kawaljeet Kaur's session: 6 of 12 asked, exited while the UI was stuck.
  const status = deriveInterviewStatus({
    interviewStatus: "COMPLETED",
    finalStatus: "FINALIZED",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "ABANDONED",
      earlyExit: true,
      terminationType: "manual_exit",
      requiredQuestionCount: 12,
      answeredQuestionCount: 6,
      completionPercentage: 0.5,
      endedAt: new Date(),
    },
  })

  assert.equal(status, "NEEDS_REVIEW")
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
  // A stale ABANDONED status on an attempt that answered everything is still a
  // completed interview -- the integrity branches must not swallow this.
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

test("a genuinely completed interview is unaffected", () => {
  const status = deriveInterviewStatus({
    interviewStatus: "COMPLETED",
    finalStatus: "FINALIZED",
    latestAttempt: {
      attemptId: "attempt-1",
      status: "COMPLETED",
      earlyExit: false,
      terminationType: "completed",
      requiredQuestionCount: 12,
      answeredQuestionCount: 12,
      completionPercentage: 1,
      endedAt: new Date(),
    },
  })

  assert.equal(status, "COMPLETED")
})
