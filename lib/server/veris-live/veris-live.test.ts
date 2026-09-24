import assert from "node:assert/strict"
import { afterEach, test } from "node:test"

import { bucketStatuses, parseCreateLiveInterviewInput } from "@/lib/server/services/live-interviews"
import { aiInterviewsOnly } from "@/lib/server/veris-live/ai-scope"
import { isVerisLiveFlagEnabled } from "@/lib/server/veris-live/feature-flag"
import {
  generateInviteToken,
  generateLivekitIdentity,
  generateRoomName,
  hashInviteToken,
  inviteExpiry,
} from "@/lib/server/veris-live/tokens"

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const JOB = "11111111-1111-4111-8111-111111111111"
const CAND = "22222222-2222-4222-8222-222222222222"
const U1 = "33333333-3333-4333-8333-333333333333"
const NOW = new Date("2026-09-24T10:00:00Z")

const savedEnv = { ...process.env }
afterEach(() => {
  process.env.VERIS_LIVE_ENABLED = savedEnv.VERIS_LIVE_ENABLED
  process.env.VERIS_LIVE_ORG_IDS = savedEnv.VERIS_LIVE_ORG_IDS
  if (savedEnv.VERIS_LIVE_ENABLED === undefined) delete process.env.VERIS_LIVE_ENABLED
  if (savedEnv.VERIS_LIVE_ORG_IDS === undefined) delete process.env.VERIS_LIVE_ORG_IDS
})

test("feature flag is off by default and honours the org allowlist", () => {
  delete process.env.VERIS_LIVE_ENABLED
  delete process.env.VERIS_LIVE_ORG_IDS
  assert.equal(isVerisLiveFlagEnabled(ORG), false)

  process.env.VERIS_LIVE_ENABLED = "true"
  assert.equal(isVerisLiveFlagEnabled(ORG), true)

  process.env.VERIS_LIVE_ORG_IDS = ` ${ORG.toUpperCase()} , `
  assert.equal(isVerisLiveFlagEnabled(ORG), true)
  assert.equal(isVerisLiveFlagEnabled(OTHER), false)
  assert.equal(isVerisLiveFlagEnabled(null), false)

  process.env.VERIS_LIVE_ENABLED = "false"
  assert.equal(isVerisLiveFlagEnabled(ORG), false)
})

test("invite tokens are high-entropy, prefixed, and stored only as sha256", () => {
  const a = generateInviteToken()
  const b = generateInviteToken()
  assert.match(a, /^vl_inv_[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a, b)
  assert.match(hashInviteToken(a), /^[0-9a-f]{64}$/)
  assert.notEqual(hashInviteToken(a), a)
  assert.equal(hashInviteToken(a), hashInviteToken(a))
})

test("LiveKit identities and room names are opaque and match the DB constraint", () => {
  const identity = generateLivekitIdentity()
  assert.match(identity, /^p_[A-Za-z0-9_-]{16,64}$/)
  assert.notEqual(identity, generateLivekitIdentity())
  assert.match(generateRoomName(), /^vl_[0-9a-f]{32}$/)
})

test("invite expiry is 24h after the scheduled end, and never less than 24h from now", () => {
  const start = new Date("2026-09-25T10:00:00Z")
  assert.equal(inviteExpiry(start, 60, NOW).toISOString(), "2026-09-26T11:00:00.000Z")
  const past = new Date("2026-09-20T10:00:00Z")
  assert.equal(inviteExpiry(past, 60, NOW).toISOString(), "2026-09-25T10:00:00.000Z")
})

function body(overrides: Record<string, unknown> = {}) {
  return {
    jobId: JOB,
    candidateId: CAND,
    scheduledStartAt: "2026-09-25T10:00:00Z",
    scheduledTimezone: "Asia/Kolkata",
    durationMinutes: 45,
    interviewers: [{ userId: U1, panelRole: "HIRING_MANAGER" }],
    ...overrides,
  }
}

test("create input validation", () => {
  const parsed = parseCreateLiveInterviewInput(body(), NOW)
  assert.equal(parsed.durationMinutes, 45)
  assert.equal(parsed.sendInvitations, true)
  assert.deepEqual(parsed.interviewers, [{ userId: U1, panelRole: "HIRING_MANAGER" }])

  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ jobId: "x" }, /valid job/],
    [{ candidateId: "" }, /valid candidate/],
    [{ scheduledStartAt: "nope" }, /scheduled start/],
    [{ scheduledStartAt: "2026-09-24T09:00:00Z" }, /past/],
    [{ durationMinutes: 5 }, /Duration/],
    [{ durationMinutes: 500 }, /Duration/],
    [{ scheduledTimezone: "Mars/Olympus" }, /timezone/],
    [{ interviewers: [] }, /at least one/],
    [{ interviewers: [{ userId: U1 }, { userId: U1.toUpperCase() }] }, /more than once/],
    [{ interviewers: [{ userId: U1, panelRole: "CANDIDATE" }] }, /panel role/],
    [{ interviewers: Array.from({ length: 9 }, (_, i) => ({ userId: `3333333${i}-3333-4333-8333-333333333333` })) }, /At most/],
  ]
  for (const [override, message] of bad) {
    assert.throws(() => parseCreateLiveInterviewInput(body(override), NOW), (error: { code?: string; message: string }) => {
      assert.equal(error.code, "INVALID_LIVE_INTERVIEW")
      assert.match(error.message, message)
      return true
    })
  }
})

test("bucket mapping covers every status exactly once", () => {
  const all = [...bucketStatuses("upcoming"), ...bucketStatuses("in_progress"), ...bucketStatuses("completed")]
  assert.deepEqual(all.sort(), ["CANCELLED", "COMPLETED", "EXPIRED", "INVITATIONS_SENT", "IN_PROGRESS", "SCHEDULED"])
})

test("aiInterviewsOnly rejects unsafe aliases", () => {
  assert.doesNotThrow(() => aiInterviewsOnly("i"))
  assert.throws(() => aiInterviewsOnly("i; drop table x"))
})
