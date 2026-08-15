import assert from "node:assert/strict"
import test from "node:test"

import {
  inferSessionBaselineMs,
  placeMarkerInRecording,
  recordingDurationMs,
} from "./recording-timeline.ts"

// Real geometry from the attempt that triggered this: capture began 07:20:11.7,
// the LiveKit egress ran 07:20:23 -> 07:50:05, and 16 browser segments of two
// minutes each covered the same span.
const liveKit = { startedAt: "2026-08-15T07:20:23.797Z", endedAt: "2026-08-15T07:50:05.266Z" }
const browserSegment = { startedAt: "2026-08-15T07:32:11.883Z", endedAt: "2026-08-15T07:34:11.894Z" }

// An attention_loss signal 12 minutes into the session.
const marker = {
  occurredAt: "2026-08-15T07:32:19.260Z",
  recordingOffsetMs: 727_549,
}

test("measures a recording window", () => {
  assert.equal(recordingDurationMs(browserSegment), 120_011)
  assert.equal(recordingDurationMs({ startedAt: null, endedAt: null }), null)
})

test("places a marker at its true position in the full recording", () => {
  const offset = placeMarkerInRecording(marker, liveKit)
  // 07:32:19.260 - 07:20:23.797
  assert.equal(offset, 715_463)
})

test("does not trust the raw session offset as a position in the recording", () => {
  // The stored offset is 727549ms; against the LiveKit recording the true
  // position is ~12s earlier, because capture began before the egress did.
  assert.notEqual(placeMarkerInRecording(marker, liveKit), marker.recordingOffsetMs)
})

test("drops a marker that falls outside the opened segment", () => {
  // This is the bug: a 12-minute offset was being drawn onto a 2-minute clip.
  const earlySegment = {
    startedAt: "2026-08-15T07:20:11.881Z",
    endedAt: "2026-08-15T07:22:11.900Z",
  }
  assert.equal(placeMarkerInRecording(marker, earlySegment), null)
})

test("keeps a marker that genuinely falls inside the opened segment", () => {
  const offset = placeMarkerInRecording(marker, browserSegment)
  // 07:32:19.260 - 07:32:11.883
  assert.equal(offset, 7_377)
})

test("infers the session baseline the offsets were measured from", () => {
  const baseline = inferSessionBaselineMs([
    { occurredAt: "2026-08-15T07:25:43.214Z", recordingOffsetMs: 331_539 },
    { occurredAt: "2026-08-15T07:31:05.261Z", recordingOffsetMs: 653_562 },
    { occurredAt: "2026-08-15T07:32:19.260Z", recordingOffsetMs: 727_549 },
  ])

  // Individual samples imply .675 / .699 / .711; the median resists the spread.
  assert.equal(new Date(baseline!).toISOString(), "2026-08-15T07:20:11.699Z")
})

test("rebases an offset-only marker onto the opened recording", () => {
  const baseline = Date.parse("2026-08-15T07:20:11.700Z")
  const offset = placeMarkerInRecording(
    { occurredAt: null, recordingOffsetMs: 727_549 },
    browserSegment,
    { sessionBaselineMs: baseline }
  )

  // baseline + 727549 = 07:32:19.249, which is 7.4s into this segment.
  assert.equal(offset, 7_366)
})

test("drops an offset-only marker that rebases outside the recording", () => {
  const baseline = Date.parse("2026-08-15T07:20:11.700Z")
  assert.equal(
    placeMarkerInRecording(
      { occurredAt: null, recordingOffsetMs: 727_549 },
      { startedAt: "2026-08-15T07:20:11.881Z", endedAt: "2026-08-15T07:22:11.900Z" },
      { sessionBaselineMs: baseline }
    ),
    null
  )
})
