/**
 * VERIS Live integrity and session evidence on the report timeline (pure).
 *
 * veris-live records each observation as a start / end pair on
 * live_interview_events (see 026_veris_live_integrity_signals.sql). This pairs
 * them so the timeline can say "Camera unavailable — 8 sec", and counts them
 * for the Debrief. Factual only: no score, no verdict, and none of it is sent
 * to the AI summary.
 */

/** Start -> end event type. Screen sharing is paired the same way, for duration. */
export const LIVE_SIGNAL_PAIRS: Record<string, string> = {
  FACE_NOT_VISIBLE: "FACE_NOT_VISIBLE_ENDED",
  MULTIPLE_FACES_DETECTED: "MULTIPLE_FACES_CLEARED",
  CAMERA_UNAVAILABLE: "CAMERA_RESTORED",
  PAGE_VISIBILITY_HIDDEN: "PAGE_VISIBILITY_RESTORED",
  SCREEN_SHARE_STARTED: "SCREEN_SHARE_STOPPED",
}
const END_TYPES = new Map(Object.entries(LIVE_SIGNAL_PAIRS).map(([start, end]) => [end, start]))
export const SESSION_CHANGE = "SESSION_CHANGE_DETECTED"

/** Event types that belong to the integrity / session evidence section. */
export const LIVE_EVIDENCE_TYPES = new Set([...Object.keys(LIVE_SIGNAL_PAIRS), ...Object.values(LIVE_SIGNAL_PAIRS), SESSION_CHANGE])

/**
 * RESOLVED: the condition cleared. CHECK_PAUSED: the check stopped (camera off
 * or page hidden). LEFT_ROOM / REJOINED: closed when the candidate left or came
 * back on a new page. INTERVIEW_ENDED: still open when the interview ended.
 */
export type LiveSignalEndReason = "RESOLVED" | "CHECK_PAUSED" | "LEFT_ROOM" | "REJOINED" | "INTERVIEW_ENDED"

export type LiveTimelineInput = { type: string; participantId: string | null; participant: string | null; at: string; payload: Record<string, unknown> | null }
export type LiveTimelineItem = {
  type: string
  participant: string | null
  at: string
  /** Start events: how long it lasted (null while still going). */
  durationSeconds?: number | null
  /** Start events: how it ended. End events: why. */
  endReason?: LiveSignalEndReason | null
}

/**
 * Adds duration / end reason to paired events. Only the fields named here
 * leave the payload (never session tags or anything else stored there).
 */
export function annotateLiveTimeline(events: LiveTimelineInput[], endedAt: string | null): LiveTimelineItem[] {
  const items: LiveTimelineItem[] = events.map((e) => ({ type: e.type, participant: e.participant, at: e.at }))
  const open = new Map<string, number>()
  const keyOf = (start: string, participantId: string | null) => `${start}:${participantId ?? ""}`

  events.forEach((e, index) => {
    if (LIVE_SIGNAL_PAIRS[e.type]) {
      items[index].durationSeconds = null
      items[index].endReason = null
      open.set(keyOf(e.type, e.participantId), index)
      return
    }
    const start = END_TYPES.get(e.type)
    if (!start) return
    const reason = (typeof e.payload?.reason === "string" ? e.payload.reason : "RESOLVED") as LiveSignalEndReason
    items[index].endReason = reason
    const startIndex = open.get(keyOf(start, e.participantId))
    if (startIndex === undefined) return
    open.delete(keyOf(start, e.participantId))
    const durationMs = Number(e.payload?.durationMs)
    items[startIndex].durationSeconds = Math.round(
      (Number.isFinite(durationMs) ? durationMs : Date.parse(e.at) - Date.parse(events[startIndex].at)) / 1000
    )
    items[startIndex].endReason = reason
  })

  // Anything still open when the interview ended is closed at the end time.
  if (endedAt) {
    for (const index of open.values()) {
      items[index].durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(items[index].at)) / 1000))
      items[index].endReason = "INTERVIEW_ENDED"
    }
  }
  return items
}

/** Counts and the evidence-only timeline for the Debrief. */
export function liveIntegrityEvidence(timeline: LiveTimelineItem[]) {
  const count = (type: string) => timeline.filter((e) => e.type === type).length
  return {
    counts: {
      faceNotVisible: count("FACE_NOT_VISIBLE"),
      multipleFaces: count("MULTIPLE_FACES_DETECTED"),
      cameraUnavailable: count("CAMERA_UNAVAILABLE"),
      pageHidden: count("PAGE_VISIBILITY_HIDDEN"),
      screenShares: count("SCREEN_SHARE_STARTED"),
      sessionChanges: count(SESSION_CHANGE),
    },
    // A non-resolved ending is shown on its start line ("— until the candidate left"), not as its own line.
    timeline: timeline.filter((e) => LIVE_EVIDENCE_TYPES.has(e.type) && !(END_TYPES.has(e.type) && e.endReason && e.endReason !== "RESOLVED")),
  }
}
