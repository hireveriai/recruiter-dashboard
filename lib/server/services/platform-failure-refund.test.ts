import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { attributeInterviewFault } from "@/lib/server/services/interview-fault-attribution"

/**
 * The refund gate. refundPlatformFailureInterviewCredits() narrows candidates in
 * SQL but defers the actual decision to this predicate, so the credit rule and
 * the message shown to the recruiter can never disagree.
 */
function isRefundable(input: Parameters<typeof attributeInterviewFault>[0]) {
  return attributeInterviewFault(input).party === "VERISNOVA"
}

test("TEST 1: a normal completed interview is untouched", () => {
  const input = {
    attemptStatus: "COMPLETED",
    terminationType: "completed",
    recordingStatus: "FINALIZED",
    transcriptIntegrity: { status: "clean", remainingIssues: 0, createdPlaceholders: 0 },
  }

  assert.equal(isRefundable(input), false, "no refund")
  assert.equal(attributeInterviewFault(input).party, "INDETERMINATE", "no fault verdict")
})

test("TEST 2: a single platform-side missing answer is refundable", () => {
  const input = {
    attemptStatus: "ABANDONED",
    terminationType: "manual_exit",
    recordingStatus: "FINALIZED",
    transcriptIntegrity: { status: "repaired", remainingIssues: 0, createdPlaceholders: 1 },
  }

  assert.equal(isRefundable(input), true)
  assert.equal(attributeInterviewFault(input).code, "ANSWER_CAPTURE_LOST")
})

test("TEST 3: multiple missing answers carry dynamic counts, still one refund", () => {
  const fault = attributeInterviewFault({
    attemptStatus: "ABANDONED",
    terminationType: "network_disconnect_timeout",
    recordingStatus: "FINALIZED",
    transcriptIntegrity: { status: "needs_review", remainingIssues: 6, createdPlaceholders: 3 },
  })

  assert.equal(fault.party, "VERISNOVA")
  // Counts come from the audit, never hardcoded.
  assert.ok(fault.evidence.some((line) => line.includes("3 answer records were missing")))
  assert.ok(fault.evidence.some((line) => line.includes("6 answer(s) still unrecovered")))
})

test("TEST 4: candidate-side causes are never refunded", () => {
  const candidateSideCases = [
    { name: "left the interview", terminationType: "manual_exit", transcriptIntegrity: { status: "clean", remainingIssues: 0, createdPlaceholders: 0 } },
    { name: "closed the browser", terminationType: "browser_close", interruptionReason: "Browser page closed or refreshed" },
    { name: "lost their connection", disconnectReason: "heartbeat_timeout", terminationType: "watchdog_timeout" },
    { name: "ran out of time", attemptStatus: "TIME_EXPIRED", terminationType: "timeout", disconnectReason: "session_time_expired" },
    { name: "their own camera failed", interruptionReason: "Camera could not be accessed." },
  ]

  for (const testCase of candidateSideCases) {
    assert.equal(isRefundable(testCase), false, `must not refund when the candidate ${testCase.name}`)
  }
})

test("TEST 4b: a platform fault during a candidate-side event is still ours", () => {
  // The candidate's connection dropped, but only because our media service went
  // down first. Refusing the refund here would charge them for our outage.
  assert.equal(
    isRefundable({
      interruptionReason: "Camera stream interrupted.",
      disconnectReason: "heartbeat_timeout",
      terminationType: "watchdog_timeout",
    }),
    true
  )
})

test("TEST 6: an interview with unrecovered evidence never reads as a clean verdict", () => {
  const fault = attributeInterviewFault({
    attemptStatus: "COMPLETED",
    terminationType: "completed",
    recordingStatus: "PENDING",
    transcriptIntegrity: { status: "needs_review", remainingIssues: 1, createdPlaceholders: 0 },
  })

  assert.equal(fault.party, "VERISNOVA")
  assert.match(fault.detail, /review it before judging the score/i)
  assert.match(fault.detail, /candidate answered/i)
})

test("the refund decision is a pure function of the audit, so retries agree", () => {
  // TEST 5's database half is enforced by the partial unique index on
  // (organization_id, kind, source, source_id); this covers the other half --
  // repeated evaluation never flips the verdict and so never queues a second
  // refund attempt for an interview that already has one.
  const input = {
    attemptStatus: "ABANDONED",
    terminationType: "manual_exit",
    recordingStatus: "FINALIZED",
    transcriptIntegrity: { status: "repaired", remainingIssues: 0, createdPlaceholders: 1 },
  }

  const verdicts = Array.from({ length: 10 }, () => attributeInterviewFault(input))
  assert.equal(new Set(verdicts.map((verdict) => verdict.code)).size, 1)
  assert.ok(verdicts.every((verdict) => verdict.party === "VERISNOVA"))
})

test("reading the interviews screen performs no credit mutation", () => {
  // Requirement: GET reads refund state, the cron writes it. If a future change
  // reintroduces the mutation into the request path, this fails loudly.
  const route = readFileSync(
    join(process.cwd(), "app/api/dashboard/interviews/route.ts"),
    "utf8"
  )

  assert.ok(
    route.includes("getPlatformFailureRefundedInterviewIds"),
    "GET should still read the refund state"
  )
  assert.equal(
    /refundPlatformFailureInterviewCredits\s*\(/.test(route),
    false,
    "GET must not perform the refund itself"
  )
  assert.equal(
    /refundAllPlatformFailureInterviewCredits\s*\(/.test(route),
    false,
    "GET must not perform the workspace sweep either"
  )
})

test("historical platform failures are not excluded by any date floor", () => {
  // Requirement: the existing internal/test interviews must stay eligible, so
  // the refund path must never gain a cutoff.
  const source = readFileSync(
    join(process.cwd(), "lib/server/services/trial-credits.ts"),
    "utf8"
  )
  const platformSection = source.slice(
    source.indexOf("Platform-failure interview credit refunds")
  )

  assert.ok(platformSection.length > 0, "platform-failure section should exist")
  assert.equal(
    /(started_at|created_at|refundedAfter|cutoff)\s*(>=|>)/.test(platformSection),
    false,
    "no date cutoff may be applied to platform-failure refunds"
  )
})

test("the refund is written to the existing ledger, not a parallel one", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/server/services/trial-credits.ts"),
    "utf8"
  )
  const platformSection = source.slice(
    source.indexOf("Platform-failure interview credit refunds")
  )

  assert.ok(platformSection.includes("public.workspace_trial_credit_events"))
  assert.ok(
    platformSection.includes("on conflict do nothing"),
    "insert must rely on the unique index for idempotency"
  )
})
