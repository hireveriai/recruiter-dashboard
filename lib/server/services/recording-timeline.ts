/**
 * Positions review markers inside the recording the recruiter actually opened.
 *
 * Signals store `recordingOffsetMs` against a single session-wide baseline (the
 * moment capture began). An attempt can own many recordings -- one full-length
 * LiveKit egress plus a rolling series of short browser segments -- so that
 * number is only meaningful for whichever recording shares that baseline.
 *
 * Using it verbatim put every marker from a 30-minute interview onto a
 * 2-minute segment, which is how a recruiter came to see "attention lost" over
 * footage where the candidate was plainly present and looking at the camera.
 */

export type MarkerPlacementInput = {
  /** Absolute time the signal fired. */
  occurredAt: string | null
  /** Session-relative offset recorded by the client, if any. */
  recordingOffsetMs: number | null
  /** Fallback offsets derived from the question this signal belongs to. */
  questionOffsetMs?: number | null
}

export type RecordingWindow = {
  startedAt: string | null
  endedAt: string | null
}

function toTime(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

export function recordingDurationMs(window: RecordingWindow) {
  const start = toTime(window.startedAt)
  const end = toTime(window.endedAt)

  if (start === null || end === null || end <= start) {
    return null
  }

  return end - start
}

/**
 * Resolves a marker's offset within `window`, or null when the signal belongs
 * to a different stretch of the interview than this recording covers.
 *
 * Absolute timestamps are authoritative: they are directly comparable to the
 * recording's own window, whereas `recordingOffsetMs` is only usable once
 * rebased, and only when we have no absolute time to rebase from.
 */
export function placeMarkerInRecording(
  marker: MarkerPlacementInput,
  window: RecordingWindow,
  options?: { sessionBaselineMs?: number | null }
): number | null {
  const start = toTime(window.startedAt)
  const duration = recordingDurationMs(window)
  const occurred = toTime(marker.occurredAt)

  if (start !== null && occurred !== null) {
    const offset = occurred - start
    if (offset < 0 || (duration !== null && offset > duration)) {
      return null
    }
    return offset
  }

  // No absolute time: rebase the session-relative offset onto this recording,
  // which is only possible when we know where the session baseline sits.
  const baseline = options?.sessionBaselineMs ?? null
  if (marker.recordingOffsetMs !== null && baseline !== null && start !== null) {
    const offset = baseline + marker.recordingOffsetMs - start
    if (offset < 0 || (duration !== null && offset > duration)) {
      return null
    }
    return offset
  }

  const questionOffset = marker.questionOffsetMs ?? null
  if (questionOffset !== null) {
    if (questionOffset < 0 || (duration !== null && questionOffset > duration)) {
      return null
    }
    return questionOffset
  }

  return null
}

/**
 * Infers the session baseline that `recordingOffsetMs` values were measured
 * from, by subtracting each offset from its own absolute timestamp. Signals
 * that disagree are ignored via the median, so one bad sample cannot skew it.
 */
export function inferSessionBaselineMs(
  markers: Array<Pick<MarkerPlacementInput, "occurredAt" | "recordingOffsetMs">>
) {
  const baselines = markers
    .map((marker) => {
      const occurred = toTime(marker.occurredAt)
      if (occurred === null || marker.recordingOffsetMs === null) {
        return null
      }
      return occurred - marker.recordingOffsetMs
    })
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)

  if (baselines.length === 0) {
    return null
  }

  return baselines[Math.floor(baselines.length / 2)]
}
