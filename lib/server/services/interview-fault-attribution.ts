/**
 * Who broke the interview: us, or the candidate?
 *
 * When a candidate says "it glitched", a recruiter currently has no way to
 * check. The evidence to answer it is already recorded on interview_attempts --
 * interruption_reason, disconnect_reason, and the transcript_integrity audit --
 * but it lived only as prose in a frontend lookup table, reachable only when the
 * status happened to be INTERRUPTED. This turns that evidence into a stable,
 * queryable verdict.
 *
 * Derived at read time from columns that already exist, so it applies to every
 * historical attempt without a migration or backfill.
 *
 * PRECEDENCE: a VerisNova fault always outranks a candidate one. If our media
 * service restarted and the candidate also dropped their connection, ours is
 * the headline -- our failure may well have caused theirs, and it is never
 * defensible to report our own fault as the candidate's.
 */

export type FaultParty = "VERISNOVA" | "CANDIDATE" | "INDETERMINATE"

export type FaultAttribution = {
  party: FaultParty
  code: string
  /** Short label for a badge. */
  title: string
  /** One sentence a recruiter can act on, stating who caused it up front. */
  detail: string
  /** The specific observations behind the verdict, for the details panel. */
  evidence: string[]
}

export type FaultAttributionInput = {
  interruptionReason?: string | null
  disconnectReason?: string | null
  terminationType?: string | null
  attemptStatus?: string | null
  recordingStatus?: string | null
  reconnectCount?: number | null
  /** interview_attempts.termination_metadata -> 'transcript_integrity' */
  transcriptIntegrity?: {
    status?: string | null
    remainingIssues?: number | null
    createdPlaceholders?: number | null
    repairedAnswers?: number | null
  } | null
}

function norm(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase()
}

/**
 * Failures inside our own infrastructure. These strings are produced by the
 * interview client when OUR camera/realtime services restart mid-session -- not
 * by anything the candidate did.
 */
const VERISNOVA_MEDIA_FAULTS = [
  "camera stream interrupted",
  "realtime interview link was interrupted",
  "realtime interview connection ended unexpectedly",
  "livekit_room",
  "camera_stream",
]

/** The candidate's own device, browser, or permissions. */
const CANDIDATE_DEVICE_FAULTS = [
  "camera track ended unexpectedly",
  "camera could not be accessed",
  "camera_track_ended",
  "camera_acquisition_failed",
  "microphone_failure",
  "camera_failure",
]

/** The candidate's network dropped or kept dropping. */
const CANDIDATE_NETWORK_FAULTS = [
  "heartbeat timed out",
  "heartbeat_timeout",
  "heartbeat_failure",
  "excessive_reconnects",
  "network_disconnect_timeout",
  "disconnect",
]

/** The candidate left of their own accord. */
const CANDIDATE_EXIT_FAULTS = [
  "browser page closed or refreshed",
  "browser_close",
  "tab_close",
]

function matchesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle))
}

export function attributeInterviewFault(
  input: FaultAttributionInput
): FaultAttribution {
  const interruption = norm(input.interruptionReason)
  const disconnect = norm(input.disconnectReason)
  const termination = norm(input.terminationType)
  const recordingStatus = norm(input.recordingStatus)
  const combined = `${interruption} ${disconnect}`.trim()

  const integrity = input.transcriptIntegrity ?? null
  const remainingIssues = Number(integrity?.remainingIssues ?? 0)
  const createdPlaceholders = Number(integrity?.createdPlaceholders ?? 0)
  const integrityNeedsReview = norm(integrity?.status) === "needs_review"

  const evidence: string[] = []

  // ---- VerisNova faults, highest precedence first ----

  // We never received answers the candidate gave, and had to synthesize the
  // rows at completion time. Nothing the candidate does causes this.
  if (createdPlaceholders > 0) {
    evidence.push(
      `${createdPlaceholders} answer ${createdPlaceholders === 1 ? "record was" : "records were"} missing and had to be reconstructed after the session`
    )
    if (remainingIssues > 0) {
      evidence.push(`${remainingIssues} answer(s) still unrecovered`)
    }
    return {
      party: "VERISNOVA",
      code: "ANSWER_CAPTURE_LOST",
      title: "VerisNova platform issue",
      detail:
        "VerisNova failed to record one or more answers the candidate gave. The candidate is not at fault, and the score is based on incomplete evidence.",
      evidence,
    }
  }

  // Our transcription pipeline could not recover the audio.
  if (integrityNeedsReview || remainingIssues > 0) {
    evidence.push(
      `${remainingIssues || "Some"} answer(s) could not be transcribed, including from the recording`
    )
    return {
      party: "VERISNOVA",
      code: "TRANSCRIPTION_INCOMPLETE",
      title: "VerisNova platform issue",
      detail:
        "The candidate answered, but VerisNova could not turn part of the session into text. Their spoken answers are in the recording -- review it before judging the score.",
      evidence,
    }
  }

  // Our media infrastructure restarted mid-interview.
  if (matchesAny(combined, VERISNOVA_MEDIA_FAULTS)) {
    evidence.push(
      `Session reported: "${String(input.interruptionReason || input.disconnectReason).trim()}"`
    )
    return {
      party: "VERISNOVA",
      code: "MEDIA_SERVICE_INTERRUPTION",
      title: "VerisNova platform issue",
      detail:
        "An internal VerisNova video service restarted and interrupted the session. This was not caused by the candidate or their connection.",
      evidence,
    }
  }

  if (recordingStatus === "failed") {
    evidence.push("Session recording failed to finalize")
    return {
      party: "VERISNOVA",
      code: "RECORDING_FAILED",
      title: "VerisNova platform issue",
      detail:
        "VerisNova failed to store the session recording. Any evidence review for this interview will be incomplete.",
      evidence,
    }
  }

  // ---- Candidate-side ----

  if (matchesAny(combined, CANDIDATE_DEVICE_FAULTS)) {
    evidence.push(
      `Session reported: "${String(input.interruptionReason || input.disconnectReason).trim()}"`
    )
    return {
      party: "CANDIDATE",
      code: "CANDIDATE_DEVICE",
      title: "Candidate-side device issue",
      detail:
        "The candidate's own camera or microphone became unavailable during the interview, usually a device or browser-permission problem on their end.",
      evidence,
    }
  }

  // Checked before the network branch: a closed tab is frequently accompanied
  // by a heartbeat timeout, because closing the tab is what stopped the
  // heartbeat. Reporting that as "their connection dropped" misleads.
  if (
    matchesAny(combined, CANDIDATE_EXIT_FAULTS) ||
    termination === "browser_close" ||
    termination === "tab_close"
  ) {
    evidence.push("The candidate closed or refreshed the interview tab")
    return {
      party: "CANDIDATE",
      code: "CANDIDATE_LEFT",
      title: "Candidate closed the interview",
      detail:
        "The candidate closed or refreshed the interview tab before finishing. No platform fault was recorded for this session.",
      evidence,
    }
  }

  if (
    matchesAny(combined, CANDIDATE_NETWORK_FAULTS) ||
    termination === "watchdog_timeout" ||
    termination === "network_disconnect_timeout"
  ) {
    evidence.push("The candidate's connection dropped and did not recover in time")
    if (Number(input.reconnectCount ?? 0) > 0) {
      evidence.push(`${input.reconnectCount} reconnect attempt(s) during the session`)
    }
    return {
      party: "CANDIDATE",
      code: "CANDIDATE_NETWORK",
      title: "Candidate-side network issue",
      detail:
        "The candidate's internet connection dropped during the interview and did not recover. Answers submitted before the drop were preserved.",
      evidence,
    }
  }

  if (termination === "timeout" || norm(input.attemptStatus) === "time_expired" || disconnect.includes("session_time_expired")) {
    evidence.push("The scheduled interview time ran out before the candidate finished")
    return {
      party: "CANDIDATE",
      code: "TIME_EXPIRED",
      title: "Ran out of time",
      detail:
        "The candidate did not finish within the scheduled interview window. No platform fault was recorded for this session.",
      evidence,
    }
  }

  if (termination === "manual_exit") {
    evidence.push("The candidate chose to end the interview early")
    return {
      party: "CANDIDATE",
      code: "CANDIDATE_ENDED_EARLY",
      title: "Candidate ended early",
      detail:
        "The candidate ended the interview themselves, and no platform fault was recorded for this session.",
      evidence,
    }
  }

  return {
    party: "INDETERMINATE",
    code: "UNDETERMINED",
    title: "Cause not determined",
    detail:
      "This session did not finish cleanly, but VerisNova did not record a specific cause. Review the recording and answer log before deciding.",
    evidence: [],
  }
}
