import assert from "node:assert/strict"
import test from "node:test"

import { attributeInterviewFault } from "@/lib/server/services/interview-fault-attribution"

test("a lost answer record is our fault, even when the candidate pressed exit", () => {
  // Kawaljeet Kaur: we failed to store her Q6 answer and reconstructed it at
  // completion. She then exited a stuck screen, which alone looks candidate-side.
  const fault = attributeInterviewFault({
    attemptStatus: "ABANDONED",
    terminationType: "manual_exit",
    recordingStatus: "FINALIZED",
    reconnectCount: 0,
    transcriptIntegrity: { status: "repaired", remainingIssues: 0, createdPlaceholders: 1, repairedAnswers: 5 },
  })

  assert.equal(fault.party, "VERISNOVA")
  assert.equal(fault.code, "ANSWER_CAPTURE_LOST")
})

test("an unrecoverable transcript is our fault", () => {
  // Sweta Chauhan: answered everything, browser speech capture returned nothing.
  const fault = attributeInterviewFault({
    attemptStatus: "COMPLETED",
    terminationType: "completed",
    recordingStatus: "PENDING",
    transcriptIntegrity: { status: "needs_review", remainingIssues: 1, createdPlaceholders: 0, repairedAnswers: 2 },
  })

  assert.equal(fault.party, "VERISNOVA")
  assert.equal(fault.code, "TRANSCRIPTION_INCOMPLETE")
})

test("our camera service restarting is our fault, not the candidate's", () => {
  const fault = attributeInterviewFault({
    interruptionReason: "Camera stream interrupted.",
    disconnectReason: "heartbeat_timeout",
    terminationType: "watchdog_timeout",
  })

  assert.equal(fault.party, "VERISNOVA")
  assert.equal(fault.code, "MEDIA_SERVICE_INTERRUPTION")
})

test("a platform fault outranks a concurrent candidate disconnect", () => {
  // Both signals present. Ours must win: our failure may have caused theirs.
  const fault = attributeInterviewFault({
    interruptionReason: "Realtime interview link was interrupted.",
    disconnectReason: "excessive_reconnects",
    terminationType: "watchdog_timeout",
    reconnectCount: 4,
  })

  assert.equal(fault.party, "VERISNOVA")
})

test("the candidate's own camera failing is theirs", () => {
  const fault = attributeInterviewFault({
    interruptionReason: "Camera could not be accessed.",
    terminationType: "manual_exit",
  })

  assert.equal(fault.party, "CANDIDATE")
  assert.equal(fault.code, "CANDIDATE_DEVICE")
})

test("a heartbeat timeout with no platform fault is a candidate network drop", () => {
  const fault = attributeInterviewFault({
    disconnectReason: "heartbeat_timeout",
    terminationType: "watchdog_timeout",
    reconnectCount: 3,
    transcriptIntegrity: { status: "clean", remainingIssues: 0, createdPlaceholders: 0 },
  })

  assert.equal(fault.party, "CANDIDATE")
  assert.equal(fault.code, "CANDIDATE_NETWORK")
  assert.ok(fault.evidence.some((line) => line.includes("3 reconnect")))
})

test("closing the tab is the candidate's doing", () => {
  const fault = attributeInterviewFault({
    interruptionReason: "Browser page closed or refreshed",
    terminationType: "browser_close",
  })

  assert.equal(fault.party, "CANDIDATE")
  assert.equal(fault.code, "CANDIDATE_LEFT")
})

test("running out of time is the candidate's", () => {
  const fault = attributeInterviewFault({
    attemptStatus: "TIME_EXPIRED",
    disconnectReason: "session_time_expired",
    terminationType: "timeout",
  })

  assert.equal(fault.party, "CANDIDATE")
  assert.equal(fault.code, "TIME_EXPIRED")
})

test("a clean early exit with no platform fault is the candidate's choice", () => {
  const fault = attributeInterviewFault({
    attemptStatus: "ABANDONED",
    terminationType: "manual_exit",
    recordingStatus: "FINALIZED",
    transcriptIntegrity: { status: "clean", remainingIssues: 0, createdPlaceholders: 0 },
  })

  assert.equal(fault.party, "CANDIDATE")
  assert.equal(fault.code, "CANDIDATE_ENDED_EARLY")
})

test("a clean completed interview yields no fault verdict", () => {
  const fault = attributeInterviewFault({
    attemptStatus: "COMPLETED",
    terminationType: "completed",
    recordingStatus: "FINALIZED",
    transcriptIntegrity: { status: "clean", remainingIssues: 0, createdPlaceholders: 0 },
  })

  assert.equal(fault.party, "INDETERMINATE")
})

test("every verdict names the responsible party in its detail text", () => {
  const ours = attributeInterviewFault({ interruptionReason: "Camera stream interrupted." })
  const theirs = attributeInterviewFault({ disconnectReason: "heartbeat_timeout" })

  assert.match(ours.detail, /VerisNova/)
  assert.match(theirs.detail, /candidate/i)
})

test("a closed tab is reported as leaving, not as a network drop", () => {
  // Real production combination. Closing the tab is what stopped the heartbeat,
  // so calling this a connection drop would describe the symptom, not the cause.
  const fault = attributeInterviewFault({
    attemptStatus: "ABANDONED",
    interruptionReason: "Browser page closed or refreshed",
    disconnectReason: "heartbeat_timeout",
    terminationType: "watchdog_timeout",
    recordingStatus: "FINALIZED",
    transcriptIntegrity: { status: "clean", remainingIssues: 0, createdPlaceholders: 0 },
  })

  assert.equal(fault.party, "CANDIDATE")
  assert.equal(fault.code, "CANDIDATE_LEFT")
})

test("the candidate's own camera failing outranks a concurrent reconnect storm", () => {
  const fault = attributeInterviewFault({
    attemptStatus: "ABANDONED",
    interruptionReason: "Camera could not be accessed.",
    disconnectReason: "excessive_reconnects",
    terminationType: "watchdog_timeout",
  })

  assert.equal(fault.code, "CANDIDATE_DEVICE")
})

test("an integrity failure outranks any reason string", () => {
  // "Failed to fetch" is uninformative; the transcript audit is not.
  const fault = attributeInterviewFault({
    attemptStatus: "COMPLETED",
    interruptionReason: "Failed to fetch",
    terminationType: "completed",
    recordingStatus: "FINALIZED",
    transcriptIntegrity: { status: "needs_review", remainingIssues: 2, createdPlaceholders: 0 },
  })

  assert.equal(fault.party, "VERISNOVA")
  assert.equal(fault.code, "TRANSCRIPTION_INCOMPLETE")
})
