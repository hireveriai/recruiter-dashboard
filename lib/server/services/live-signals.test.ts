import assert from "node:assert/strict"
import { test } from "node:test"

import { annotateLiveTimeline, liveIntegrityEvidence, type LiveTimelineInput } from "@/lib/server/services/live-signals"

const CAND = "cand-1"
const at = (min: number, sec = 0) => new Date(Date.UTC(2026, 9, 1, 10, min, sec)).toISOString()
const ev = (type: string, time: string, payload: Record<string, unknown> | null = null, participantId: string | null = CAND): LiveTimelineInput => ({
  type,
  participantId,
  participant: participantId ? "Casey" : null,
  at: time,
  payload,
})

test("starts carry their duration and how they ended; open ones close at the end of the interview", () => {
  const timeline = annotateLiveTimeline(
    [
      ev("PARTICIPANT_JOINED", at(21), { session: "abc123def4567890" }),
      ev("SCREEN_SHARE_STARTED", at(31), {}),
      ev("PAGE_VISIBILITY_HIDDEN", at(38), {}),
      ev("PAGE_VISIBILITY_RESTORED", at(39, 5), { startedAt: at(38), durationMs: 65_000, reason: "RESOLVED" }),
      ev("CAMERA_UNAVAILABLE", at(42, 3), {}),
      ev("CAMERA_RESTORED", at(42, 11), { startedAt: at(42, 3), durationMs: 8_000, reason: "RESOLVED" }),
      ev("SCREEN_SHARE_STOPPED", at(44), {}),
      ev("FACE_NOT_VISIBLE", at(45), {}),
      ev("FACE_NOT_VISIBLE_ENDED", at(46), { durationMs: 60_000, reason: "LEFT_ROOM" }),
      ev("SESSION_CHANGE_DETECTED", at(47), { reason: "NEW_BROWSER_SESSION" }),
      ev("MULTIPLE_FACES_DETECTED", at(50), {}),
    ],
    at(55)
  )
  const by = (type: string) => timeline.find((e) => e.type === type)!

  assert.equal(by("PAGE_VISIBILITY_HIDDEN").durationSeconds, 65)
  assert.equal(by("CAMERA_UNAVAILABLE").durationSeconds, 8)
  assert.equal(by("CAMERA_UNAVAILABLE").endReason, "RESOLVED")
  assert.equal(by("SCREEN_SHARE_STARTED").durationSeconds, 13 * 60, "screen sharing measured from its timestamps")
  assert.equal(by("FACE_NOT_VISIBLE").endReason, "LEFT_ROOM")
  assert.equal(by("MULTIPLE_FACES_DETECTED").durationSeconds, 5 * 60)
  assert.equal(by("MULTIPLE_FACES_DETECTED").endReason, "INTERVIEW_ENDED")
  assert.ok(!JSON.stringify(timeline).includes("abc123def4567890"), "session tags never leave the payload")

  const evidence = liveIntegrityEvidence(timeline)
  assert.deepEqual(evidence.counts, { faceNotVisible: 1, multipleFaces: 1, cameraUnavailable: 1, pageHidden: 1, screenShares: 1, sessionChanges: 1 })
  assert.deepEqual(
    evidence.timeline.map((e) => e.type),
    [
      "SCREEN_SHARE_STARTED",
      "PAGE_VISIBILITY_HIDDEN",
      "PAGE_VISIBILITY_RESTORED",
      "CAMERA_UNAVAILABLE",
      "CAMERA_RESTORED",
      "SCREEN_SHARE_STOPPED",
      "FACE_NOT_VISIBLE",
      "SESSION_CHANGE_DETECTED",
      "MULTIPLE_FACES_DETECTED",
    ],
    "joins are not evidence; an end that wasn't a recovery is folded into its start line"
  )
})

test("an interview still running leaves an open observation without a duration", () => {
  const timeline = annotateLiveTimeline([ev("CAMERA_UNAVAILABLE", at(10))], null)
  assert.equal(timeline[0].durationSeconds, null)
  assert.equal(timeline[0].endReason, null)
})

test("pairs are per participant", () => {
  const timeline = annotateLiveTimeline(
    [ev("SCREEN_SHARE_STARTED", at(1), {}, "a"), ev("SCREEN_SHARE_STARTED", at(2), {}, "b"), ev("SCREEN_SHARE_STOPPED", at(4), {}, "a")],
    at(10)
  )
  assert.equal(timeline[0].durationSeconds, 180)
  assert.equal(timeline[1].durationSeconds, 480)
  assert.equal(timeline[1].endReason, "INTERVIEW_ENDED")
})
