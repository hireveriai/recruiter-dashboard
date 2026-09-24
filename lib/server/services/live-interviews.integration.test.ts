/**
 * VERIS Live control plane against a real Postgres (throwaway database with
 * migration 023). Billing, questionnaire generation and email are injected
 * fakes, so no network call is made. Skips without TEST_DATABASE_URL.
 */

import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import {
  VERIS_LIVE_SQL_FILES,
  createFocusTestDatabase,
  useTestDatabaseForPrisma,
} from "../../../test/support/focus-test-database.ts"

const db = await createFocusTestDatabase(VERIS_LIVE_SQL_FILES)
const suite = db ? test : test.skip

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

let svc: typeof import("@/lib/server/services/live-interviews")
let tokens: typeof import("@/lib/server/veris-live/tokens")
let prismaModule: typeof import("@/lib/server/prisma")

type Row = Record<string, unknown>
async function q<T extends Row = Row>(sql: string, params: unknown[] = []) {
  return (await db!.pool.query<T>(sql, params)).rows
}

let jobA: string
let candA: string
let candB: string
let hiringManager: string
let panelist: string
let removedUser: string
let userB: string

const sentEmails: Array<{ to: string; link: string; audience: string }> = []
const deducted: string[] = []
let failDeduct = false
let failEmailFor: string | null = null

const deps = {
  assertCredits: async () => {},
  deductCredit: async (_org: string, interviewId: string) => {
    if (failDeduct) throw new Error("credit ledger down")
    deducted.push(interviewId)
  },
  ensureQuestionnaire: async () => "99999999-9999-4999-8999-999999999999",
  snapshotQuestionnaire: async (_org: string, interviewId: string) => {
    await q(
      `insert into public.interview_questions (interview_id, question_order, question_text, question_type, source_type)
       values ($1, 1, 'Walk me through a recent project.', 'behavioral', 'job')`,
      [interviewId]
    )
  },
  sendInvitationEmail: async (params: { to: string; link: string; audience: string }) => {
    if (failEmailFor && params.to === failEmailFor) throw new Error("mailbox unavailable")
    sentEmails.push({ to: params.to, link: params.link, audience: params.audience })
  },
}

function input(overrides: Partial<import("@/lib/server/services/live-interviews").CreateLiveInterviewInput> = {}) {
  return {
    jobId: jobA,
    candidateId: candA,
    scheduledStartAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    scheduledTimezone: "UTC",
    durationMinutes: 45,
    interviewers: [
      { userId: hiringManager, panelRole: "HIRING_MANAGER" as const },
      { userId: panelist, panelRole: "PANEL_MEMBER" as const },
    ],
    sendInvitations: true,
    ...overrides,
  }
}

before(async () => {
  if (!db) return
  useTestDatabaseForPrisma(db.url)
  process.env.VERIS_LIVE_APP_URL = "https://live.test"
  svc = await import("@/lib/server/services/live-interviews")
  tokens = await import("@/lib/server/veris-live/tokens")
  prismaModule = await import("@/lib/server/prisma")

  await q(`insert into public.organizations (organization_id, organization_name, timezone) values ($1, 'Acme', 'UTC'), ($2, 'Other', 'UTC')`, [ORG_A, ORG_B])
  jobA = (await q<{ job_id: string }>(
    `insert into public.job_positions (organization_id, job_title, job_description, experience_level_id, core_skills, interview_duration_minutes, interview_mode)
     values ($1, 'Store Manager', 'Runs a store', 3, '{}', 45, 'STANDARD') returning job_id::text`, [ORG_A]
  ))[0].job_id
  const cand = async (org: string, email: string) =>
    (await q<{ candidate_id: string }>(
      `insert into public.candidates (organization_id, full_name, email) values ($1, 'Casey Candidate', $2) returning candidate_id::text`, [org, email]
    ))[0].candidate_id
  candA = await cand(ORG_A, "casey@example.com")
  candB = await cand(ORG_B, "other@example.com")
  const user = async (org: string, email: string, removed = false) =>
    (await q<{ user_id: string }>(
      `insert into public.users (organization_id, full_name, email, team_removed_at) values ($1, $2, $2, $3) returning user_id::text`,
      [org, email, removed ? new Date() : null]
    ))[0].user_id
  hiringManager = await user(ORG_A, "hm@acme.test")
  panelist = await user(ORG_A, "panel@acme.test")
  removedUser = await user(ORG_A, "gone@acme.test", true)
  userB = await user(ORG_B, "someone@other.test")
})

after(async () => {
  if (!db) return
  await prismaModule.prisma.$disconnect()
  await db.drop()
})

suite("create: LIVE row, opaque participants, credit, and hashed invitations only", async () => {
  sentEmails.length = 0
  const result = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input(), deps })
  assert.deepEqual(result.invitations, { sent: 3, failed: 0 })
  assert.deepEqual(deducted, [result.interviewId])

  const [row] = await q(`select delivery_mode, live_status, status, question_status, email_status, interview_type, live_room_name
                          from public.interviews where interview_id = $1`, [result.interviewId])
  assert.equal(row.delivery_mode, "LIVE")
  assert.equal(row.live_status, "INVITATIONS_SENT")
  assert.equal(row.status, "LIVE")
  assert.equal(row.question_status, "NOT_APPLICABLE")
  assert.equal(row.email_status, "NOT_APPLICABLE")
  assert.equal(row.interview_type, "COMPANY_INTERVIEW")
  assert.match(String(row.live_room_name), /^vl_[0-9a-f]{32}$/)

  // Never creates AI runtime rows.
  assert.equal((await q(`select 1 from public.interview_invites where interview_id = $1`, [result.interviewId])).length, 0)
  assert.equal((await q(`select 1 from public.interview_attempts where interview_id = $1`, [result.interviewId])).length, 0)

  const participants = await q<{ role: string; livekit_identity: string; invite_token_hash: string; invite_status: string; email: string }>(
    `select role, livekit_identity, invite_token_hash, invite_status, email from public.interview_participants where interview_id = $1`,
    [result.interviewId]
  )
  assert.equal(participants.length, 3)
  assert.equal(participants.filter((p) => p.role === "CANDIDATE").length, 1)
  for (const p of participants) {
    assert.match(p.livekit_identity, /^p_/)
    assert.ok(!p.livekit_identity.includes("@"))
    assert.equal(p.invite_status, "SENT")
  }

  // Every emailed token hashes to a stored hash; no raw token is stored anywhere.
  assert.equal(sentEmails.length, 3)
  const candidateMail = sentEmails.find((m) => m.to === "casey@example.com")!
  assert.equal(candidateMail.audience, "CANDIDATE")
  for (const mail of sentEmails) {
    assert.ok(mail.link.startsWith("https://live.test/join/vl_inv_"))
    const token = mail.link.split("/join/")[1]
    const owner = participants.find((p) => p.email === mail.to)!
    assert.equal(owner.invite_token_hash, tokens.hashInviteToken(token))
    const dump = await q(`select count(*)::int as n from public.interview_participants p where p::text like '%' || $1 || '%'`, [token])
    assert.equal(dump[0].n, 0, "raw token must not be persisted")
  }

  // Detail never exposes hashes or LiveKit identities.
  const detail = await svc.getLiveInterviewDetail({ organizationId: ORG_A, interviewId: result.interviewId })
  const serialized = JSON.stringify(detail)
  for (const p of participants) {
    assert.ok(!serialized.includes(p.invite_token_hash))
    assert.ok(!serialized.includes(p.livekit_identity))
  }
  assert.equal(detail.questionCount, 1)

  const upcoming = await svc.listLiveInterviews({ organizationId: ORG_A, bucket: "upcoming" })
  assert.ok(upcoming.some((r) => r.interviewId === result.interviewId))
  assert.equal((await svc.listLiveInterviews({ organizationId: ORG_B, bucket: "upcoming" })).length, 0)
})

suite("tenant isolation: another org cannot use, read or act on org A resources", async () => {
  await assert.rejects(svc.createLiveInterview({ organizationId: ORG_B, userId: userB, input: input(), deps }), { code: "JOB_NOT_FOUND" })
  await assert.rejects(
    svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ candidateId: candB }), deps }),
    { code: "CANDIDATE_NOT_FOUND" }
  )
  await assert.rejects(
    svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ interviewers: [{ userId: userB, panelRole: "INTERVIEWER" }] }), deps }),
    { code: "INTERVIEWER_NOT_IN_ORG" }
  )
  await assert.rejects(
    svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ interviewers: [{ userId: removedUser, panelRole: "INTERVIEWER" }] }), deps }),
    { code: "INTERVIEWER_NOT_IN_ORG" }
  )

  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  const [participant] = await q<{ participant_id: string }>(`select participant_id::text from public.interview_participants where interview_id = $1 limit 1`, [interviewId])
  await assert.rejects(svc.getLiveInterviewDetail({ organizationId: ORG_B, interviewId }), { code: "LIVE_INTERVIEW_NOT_FOUND" })
  await assert.rejects(svc.sendLiveInvitations({ organizationId: ORG_B, interviewId, deps }), { code: "LIVE_INTERVIEW_NOT_FOUND" })
  await assert.rejects(
    svc.revokeLiveInvitation({ organizationId: ORG_B, interviewId, participantId: participant.participant_id }),
    { code: "PARTICIPANT_NOT_FOUND" }
  )
  await assert.rejects(svc.cancelLiveInterview({ organizationId: ORG_B, interviewId }), { code: "LIVE_INTERVIEW_NOT_CANCELLABLE" })

  // The database itself rejects a cross-org participant.
  await assert.rejects(
    q(`insert into public.interview_participants (organization_id, interview_id, role, user_id, display_name, email, livekit_identity)
       values ($1, $2, 'INTERVIEWER', $3, 'x', 'x@x', 'p_crossorgcrossorg01')`, [ORG_B, interviewId, userB])
  )
})

suite("a candidate can never also be an interviewer", async () => {
  const sameEmail = (await q<{ user_id: string }>(
    `insert into public.users (organization_id, full_name, email) values ($1, 'Casey', 'CASEY@example.com') returning user_id::text`, [ORG_A]
  ))[0].user_id
  await assert.rejects(
    svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ interviewers: [{ userId: sameEmail, panelRole: "INTERVIEWER" }] }), deps }),
    { code: "CANDIDATE_CANNOT_INTERVIEW" }
  )

  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  // Second candidate row, and flipping roles, are both rejected by the DB.
  await assert.rejects(
    q(`insert into public.interview_participants (organization_id, interview_id, role, candidate_id, display_name, email, livekit_identity)
       values ($1, $2, 'CANDIDATE', $3, 'x', 'x@x', 'p_secondcandidate0001')`, [ORG_A, interviewId, candA])
  )
  await assert.rejects(
    q(`update public.interview_participants set role = 'INTERVIEWER' where interview_id = $1 and role = 'CANDIDATE'`, [interviewId])
  )
})

suite("failure after insert leaves no interview and charges nothing", async () => {
  failDeduct = true
  const before = await q<{ n: number }>(`select count(*)::int as n from public.interviews where delivery_mode = 'LIVE'`)
  try {
    await assert.rejects(svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input(), deps }), /credit ledger down/)
  } finally {
    failDeduct = false
  }
  const afterRows = await q<{ n: number }>(`select count(*)::int as n from public.interviews where delivery_mode = 'LIVE'`)
  assert.equal(afterRows[0].n, before[0].n)
})

suite("resend rotates the token, revoke kills it, failed email is recorded", async () => {
  sentEmails.length = 0
  failEmailFor = "panel@acme.test"
  let interviewId: string
  try {
    const result = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input(), deps })
    interviewId = result.interviewId
    assert.deepEqual(result.invitations, { sent: 2, failed: 1 })
  } finally {
    failEmailFor = null
  }
  const statusOf = async (email: string) =>
    (await q<{ invite_status: string; invite_token_hash: string | null; participant_id: string }>(
      `select invite_status, invite_token_hash, participant_id::text from public.interview_participants where interview_id = $1 and email = $2`,
      [interviewId, email]
    ))[0]
  assert.equal((await statusOf("panel@acme.test")).invite_status, "FAILED")

  const candidate = await statusOf("casey@example.com")
  const firstHash = candidate.invite_token_hash
  await svc.sendLiveInvitations({ organizationId: ORG_A, interviewId, participantIds: [candidate.participant_id], deps })
  const rotated = await statusOf("casey@example.com")
  assert.notEqual(rotated.invite_token_hash, firstHash, "old link no longer matches")
  assert.equal(rotated.invite_status, "SENT")

  await svc.revokeLiveInvitation({ organizationId: ORG_A, interviewId, participantId: candidate.participant_id })
  const revoked = await statusOf("casey@example.com")
  assert.equal(revoked.invite_status, "REVOKED")
  assert.equal(revoked.invite_token_hash, null)

  // A bulk resend skips revoked participants.
  sentEmails.length = 0
  await svc.sendLiveInvitations({ organizationId: ORG_A, interviewId, deps })
  assert.ok(!sentEmails.some((m) => m.to === "casey@example.com"))

  const events = await q<{ event_type: string }>(`select event_type from public.live_interview_events where interview_id = $1 order by occurred_at`, [interviewId])
  assert.ok(events.some((e) => e.event_type === "INVITATION_REVOKED"))
  await assert.rejects(q(`delete from public.live_interview_events where interview_id = $1`, [interviewId]), "events are append-only")
})

suite("cancel clears every link and blocks further invitations", async () => {
  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input(), deps })
  await svc.cancelLiveInterview({ organizationId: ORG_A, interviewId })
  const hashes = await q(`select 1 from public.interview_participants where interview_id = $1 and invite_token_hash is not null`, [interviewId])
  assert.equal(hashes.length, 0)
  await assert.rejects(svc.cancelLiveInterview({ organizationId: ORG_A, interviewId }), { code: "LIVE_INTERVIEW_NOT_CANCELLABLE" })
  await assert.rejects(svc.sendLiveInvitations({ organizationId: ORG_A, interviewId, deps }), { code: "LIVE_INTERVIEW_NOT_SCHEDULED" })
  const completed = await svc.listLiveInterviews({ organizationId: ORG_A, bucket: "completed" })
  assert.equal(completed.find((r) => r.interviewId === interviewId)?.liveStatus, "CANCELLED")
})

suite("scheduled sessions whose window passed become EXPIRED", async () => {
  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  await q(`update public.interviews set scheduled_start_at = now() - interval '3 days' where interview_id = $1`, [interviewId])
  const completed = await svc.listLiveInterviews({ organizationId: ORG_A, bucket: "completed" })
  assert.equal(completed.find((r) => r.interviewId === interviewId)?.liveStatus, "EXPIRED")
})

suite("AI read paths exclude LIVE interviews", async () => {
  const { Prisma } = await import("@prisma/client")
  const { aiInterviewsOnly } = await import("@/lib/server/veris-live/ai-scope")
  await q(`insert into public.interviews (organization_id, job_id, candidate_id) values ($1, $2, $3)`, [ORG_A, jobA, candA])
  const rows = await prismaModule.prisma.$queryRaw<Array<{ delivery_mode: string; n: number }>>(Prisma.sql`
    select i.delivery_mode, count(*)::int as n from public.interviews i
    where i.organization_id = ${ORG_A}::uuid and ${aiInterviewsOnly("i")}
    group by 1
  `)
  assert.deepEqual(rows.map((r) => r.delivery_mode), ["AI"])
  const total = await q<{ n: number }>(`select count(*)::int as n from public.interviews where organization_id = $1 and delivery_mode = 'LIVE'`, [ORG_A])
  assert.ok(total[0].n > 0, "LIVE rows exist but were filtered")
})

suite("revoke and cancel actively remove people from the LiveKit room, best-effort and idempotent", async () => {
  const calls: string[] = []
  const control = (mode: "ok" | "gone" | "boom") => ({
    removeParticipant: async (room: string, identity: string) => {
      calls.push(`remove:${room}:${identity}`)
      if (mode === "gone") throw Object.assign(new Error("participant not found"), { status: 404 })
      if (mode === "boom") throw new Error("livekit unavailable")
    },
    deleteRoom: async (room: string) => {
      calls.push(`delete:${room}`)
      if (mode === "gone") throw new Error("room does not exist")
    },
  })

  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  await q(`update public.interviews set live_status = 'IN_PROGRESS', live_started_at = now() where interview_id = $1`, [interviewId])
  const [row] = await q<{ participant_id: string; livekit_identity: string; live_room_name: string }>(
    `select p.participant_id::text, p.livekit_identity, i.live_room_name
     from public.interview_participants p join public.interviews i on i.interview_id = p.interview_id
     where p.interview_id = $1 and p.user_id = $2`, [interviewId, panelist]
  )

  // Mid-interview revoke removes exactly that identity from that room.
  const result = await svc.revokeLiveInvitation({ organizationId: ORG_A, interviewId, participantId: row.participant_id, roomControl: control("ok") })
  assert.deepEqual(result, { revoked: true, livekit: "done" })
  assert.deepEqual(calls, [`remove:${row.live_room_name}:${row.livekit_identity}`])

  // Already disconnected, LiveKit down, or not configured: the revoke itself still succeeds.
  assert.equal((await svc.revokeLiveInvitation({ organizationId: ORG_A, interviewId, participantId: row.participant_id, roomControl: control("gone") })).livekit, "not_present")
  assert.equal((await svc.revokeLiveInvitation({ organizationId: ORG_A, interviewId, participantId: row.participant_id, roomControl: control("boom") })).livekit, "failed")
  assert.equal((await svc.revokeLiveInvitation({ organizationId: ORG_A, interviewId, participantId: row.participant_id, roomControl: null })).livekit, "not_configured")
  const [after] = await q<{ invite_status: string; invite_token_hash: string | null }>(`select invite_status, invite_token_hash from public.interview_participants where participant_id = $1`, [row.participant_id])
  assert.deepEqual(after, { invite_status: "REVOKED", invite_token_hash: null })

  // Another org cannot trigger a removal.
  calls.length = 0
  await assert.rejects(
    svc.revokeLiveInvitation({ organizationId: ORG_B, interviewId, participantId: row.participant_id, roomControl: control("ok") }),
    { code: "PARTICIPANT_NOT_FOUND" }
  )
  assert.deepEqual(calls, [])

  // Cancelling before start closes the room (early-joining interviewers are disconnected).
  const second = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  const [{ live_room_name: room2 }] = await q<{ live_room_name: string }>(`select live_room_name from public.interviews where interview_id = $1`, [second.interviewId])
  assert.deepEqual(await svc.cancelLiveInterview({ organizationId: ORG_A, interviewId: second.interviewId, roomControl: control("gone") }), { cancelled: true, livekit: "not_present" })
  assert.deepEqual(calls, [`delete:${room2}`])
})

suite("report: submitted scorecards side by side, no drafts, no private notes, no combined score", async () => {
  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  const parts = await q<{ participant_id: string; role: string; user_id: string | null }>(
    `select participant_id::text, role, user_id::text from public.interview_participants where interview_id = $1`, [interviewId]
  )
  const hm = parts.find((p) => p.user_id === hiringManager)!.participant_id
  const pm = parts.find((p) => p.user_id === panelist)!.participant_id
  const cand = parts.find((p) => p.role === "CANDIDATE")!.participant_id
  const [question] = await q<{ id: string }>(`select interview_question_id::text as id from public.interview_questions where interview_id = $1`, [interviewId])

  await q(`update public.interviews set live_status = 'COMPLETED', live_started_at = now() - interval '30 minutes', live_ended_at = now() where interview_id = $1`, [interviewId])
  await q(`update public.interview_participants set recording_consent_at = now() where participant_id = $1`, [cand])
  await q(
    `insert into public.live_evaluator_ratings (organization_id, interview_id, participant_id, target_type, interview_question_id, rating, evidence, submitted_at)
     values ($1, $2, $3, 'OVERALL', null, 4, 'HM_EVIDENCE', now()), ($1, $2, $3, 'QUESTION', $5, 3, null, now()),
            ($1, $2, $4, 'OVERALL', null, 2, 'DRAFT_EVIDENCE', null)`,
    [ORG_A, interviewId, hm, pm, question.id]
  )
  await q(`insert into public.live_interviewer_notes (organization_id, interview_id, participant_id, body) values ($1, $2, $3, 'PRIVATE_NOTE_TEXT')`, [ORG_A, interviewId, hm])
  await q(
    `insert into public.live_interview_events (organization_id, interview_id, participant_id, event_type, payload)
     values ($1, $2, $3, 'COPILOT_SUGGESTION', '{"suggestions":[{"text":"COPILOT_TEXT"}]}'), ($1, $2, $3, 'MANUAL_QUESTION', '{"text":"What would you change?"}')`,
    [ORG_A, interviewId, hm]
  )
  const [recording] = await q<{ id: string }>(
    `insert into public.live_recordings (organization_id, interview_id, participant_id, kind, egress_id, storage_path, status, transcription_status)
     values ($1, $2, $3, 'PARTICIPANT_AUDIO', 'EG_report_1', 'veris-live/a/b/audio.ogg', 'COMPLETE', 'DONE') returning recording_id::text as id`,
    [ORG_A, interviewId, cand]
  )
  await q(
    `insert into public.live_transcript_segments (organization_id, interview_id, participant_id, recording_id, source, started_at_ms, ended_at_ms, text)
     values ($1, $2, $3, $4, 'POST_TRANSCRIPTION', 61000, 64000, 'I led the turnaround.')`,
    [ORG_A, interviewId, cand, recording.id]
  )

  const report = await svc.getLiveInterviewReport({ organizationId: ORG_A, interviewId })
  const json = JSON.stringify(report)
  assert.ok(!json.includes("PRIVATE_NOTE_TEXT"), "private notes never appear")
  assert.ok(!json.includes("DRAFT_EVIDENCE"), "unsubmitted drafts never appear")
  assert.ok(!json.includes("COPILOT_TEXT"), "copilot text is not surfaced")
  assert.ok(!/"(averageRating|combinedScore|finalScore|recommendation)"/.test(json), "no combined score")
  assert.ok(!json.includes("storage_path") && !json.includes("veris-live/a/b"), "storage paths are not exposed")

  const hmCard = report.scorecards.find((c) => c.participantId === hm)!
  assert.equal(hmCard.ratings.length, 2)
  assert.equal(report.scorecards.find((c) => c.participantId === pm)!.submittedAt, null)
  assert.deepEqual(report.transcript, [{ speaker: "Casey Candidate", role: "CANDIDATE", startMs: 61000, endMs: 64000, text: "I led the turnaround." }])
  assert.equal(report.copilotSuggestions, 1)
  assert.deepEqual(report.manualQuestions.map((m) => m.text), ["What would you change?"])
  assert.equal(report.participants.find((p) => p.participantId === cand)?.recordingConsent, true)

  // Org-scoped: another org gets nothing; playback path lookup is org + interview scoped.
  await assert.rejects(svc.getLiveInterviewReport({ organizationId: ORG_B, interviewId }), { code: "LIVE_INTERVIEW_NOT_FOUND" })
  assert.equal(await svc.getLiveRecordingPath({ organizationId: ORG_A, interviewId, recordingId: recording.id }), "veris-live/a/b/audio.ogg")
  await assert.rejects(svc.getLiveRecordingPath({ organizationId: ORG_B, interviewId, recordingId: recording.id }), { code: "RECORDING_NOT_FOUND" })
})
