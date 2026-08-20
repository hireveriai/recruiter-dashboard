import assert from "node:assert/strict"
import test from "node:test"

import {
  evaluateEntitlementGate,
  normalizeTrialStatus,
  resolveVisibleCredits,
} from "@/lib/server/services/trial-entitlement-policy"

test("a workspace that has not requested a trial cannot spend credits", () => {
  const gate = evaluateEntitlementGate({ source: "trial", trialStatus: "NOT_REQUESTED" })

  assert.equal(gate.allowed, false)
  assert.equal(gate.allowed === false && gate.code, "FREE_TRIAL_NOT_ACTIVE")
  assert.equal(gate.allowed === false && gate.status, 403)
})

test("a pending trial cannot spend credits and says so distinctly", () => {
  const gate = evaluateEntitlementGate({ source: "trial", trialStatus: "PENDING_REVIEW" })

  assert.equal(gate.allowed, false)
  assert.equal(gate.allowed === false && gate.code, "FREE_TRIAL_PENDING_REVIEW")
})

test("a rejected trial cannot spend credits", () => {
  const gate = evaluateEntitlementGate({ source: "trial", trialStatus: "REJECTED" })

  assert.equal(gate.allowed, false)
  assert.equal(gate.allowed === false && gate.code, "FREE_TRIAL_NOT_ACTIVE")
})

test("an approved trial may spend credits", () => {
  assert.deepEqual(evaluateEntitlementGate({ source: "trial", trialStatus: "APPROVED" }), {
    allowed: true,
  })
})

test("a paid subscription is never gated by the trial lifecycle", () => {
  for (const trialStatus of ["NOT_REQUESTED", "PENDING_REVIEW", "REJECTED", "EXPIRED"] as const) {
    assert.deepEqual(
      evaluateEntitlementGate({ source: "subscription", trialStatus }),
      { allowed: true },
      `subscription should stay usable with trial status ${trialStatus}`
    )
  }
})

test("a stored balance on an unapproved workspace is not visible or spendable", () => {
  // This is the case that matters: even if a row somehow carries 10/25, an
  // unapproved workspace must see and spend nothing.
  const visible = resolveVisibleCredits({
    source: "trial",
    trialStatus: "NOT_REQUESTED",
    interviewCreditsRemaining: 10,
    screeningCreditsRemaining: 25,
  })

  assert.equal(visible.interviewCreditsRemaining, 0)
  assert.equal(visible.screeningCreditsRemaining, 0)
  assert.equal(visible.canSendInterview, false)
  assert.equal(visible.canStartScreening, false)
  assert.equal(visible.trialActive, false)
})

test("an approved workspace sees its real balance", () => {
  const visible = resolveVisibleCredits({
    source: "trial",
    trialStatus: "APPROVED",
    interviewCreditsRemaining: 10,
    screeningCreditsRemaining: 25,
  })

  assert.equal(visible.interviewCreditsRemaining, 10)
  assert.equal(visible.screeningCreditsRemaining, 25)
  assert.equal(visible.canSendInterview, true)
  assert.equal(visible.canStartScreening, true)
})

test("an exhausted approved trial stays active but cannot send", () => {
  const visible = resolveVisibleCredits({
    source: "trial",
    trialStatus: "APPROVED",
    interviewCreditsRemaining: 0,
    screeningCreditsRemaining: 3,
  })

  assert.equal(visible.trialActive, true)
  assert.equal(visible.canSendInterview, false)
  assert.equal(visible.canStartScreening, true)
})

test("unknown or missing statuses fall back to NOT_REQUESTED", () => {
  assert.equal(normalizeTrialStatus(null), "NOT_REQUESTED")
  assert.equal(normalizeTrialStatus(""), "NOT_REQUESTED")
  assert.equal(normalizeTrialStatus("something-else"), "NOT_REQUESTED")
  assert.equal(normalizeTrialStatus("approved"), "APPROVED")
})

test("negative or malformed balances never become spendable credit", () => {
  const visible = resolveVisibleCredits({
    source: "trial",
    trialStatus: "APPROVED",
    interviewCreditsRemaining: -5,
    screeningCreditsRemaining: "not a number",
  })

  assert.equal(visible.interviewCreditsRemaining, 0)
  assert.equal(visible.screeningCreditsRemaining, 0)
})
