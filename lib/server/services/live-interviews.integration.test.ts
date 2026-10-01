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

suite("panel members can be added by email (external) or from the team; the candidate never", async () => {
  sentEmails.length = 0
  const { interviewId } = await svc.createLiveInterview({
    organizationId: ORG_A,
    userId: hiringManager,
    input: input({
      interviewers: [
        { email: "outside.expert@partner.test", name: "Olivia Outside", panelRole: "PANEL_MEMBER" },
        { email: "noname@partner.test", name: null, panelRole: "INTERVIEWER" },
        // A typed email that belongs to a team member is linked to their account.
        { email: "panel@acme.test", name: null, panelRole: "INTERVIEWER" },
        { userId: hiringManager, panelRole: "HIRING_MANAGER" },
      ],
    }),
    deps,
  })
  const rows = await q<{ email: string; user_id: string | null; display_name: string; panel_role: string }>(
    `select email, user_id::text, display_name, panel_role from public.interview_participants where interview_id = $1 and role = 'INTERVIEWER' order by email`,
    [interviewId]
  )
  assert.deepEqual(rows, [
    { email: "hm@acme.test", user_id: hiringManager, display_name: "hm@acme.test", panel_role: "HIRING_MANAGER" },
    { email: "noname@partner.test", user_id: null, display_name: "noname", panel_role: "INTERVIEWER" },
    { email: "outside.expert@partner.test", user_id: null, display_name: "Olivia Outside", panel_role: "PANEL_MEMBER" },
    { email: "panel@acme.test", user_id: panelist, display_name: "panel@acme.test", panel_role: "INTERVIEWER" },
  ])
  assert.ok(sentEmails.some((m) => m.to === "outside.expert@partner.test" && m.audience === "INTERVIEWER"))

  // Validation and duplicates.
  const bad = (interviewers: unknown[]) => () => svc.parseCreateLiveInterviewInput({ ...input(), scheduledStartAt: new Date(Date.now() + 3600_000).toISOString(), interviewers })
  assert.throws(bad([{ email: "not-an-email" }]), /valid email/)
  assert.throws(bad([{ email: "a@b.test" }, { email: "A@B.test" }]), /more than once/)
  await assert.rejects(
    svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ interviewers: [{ email: "panel@acme.test", name: null, panelRole: "INTERVIEWER" }, { userId: panelist, panelRole: "INTERVIEWER" }] }), deps }),
    /more than once/
  )
  // The candidate's own email, typed as a panel member.
  await assert.rejects(
    svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ interviewers: [{ email: "CASEY@example.com", name: null, panelRole: "INTERVIEWER" }] }), deps }),
    { code: "CANDIDATE_CANNOT_INTERVIEW" }
  )
  // ...and the database enforces it even if code is bypassed.
  await assert.rejects(
    q(`insert into public.interview_participants (organization_id, interview_id, role, panel_role, display_name, email, livekit_identity)
       values ($1, $2, 'INTERVIEWER', 'INTERVIEWER', 'x', 'casey@example.com', 'p_candidateaspanel0001')`, [ORG_A, interviewId]),
    /LIVE_PARTICIPANT_CANDIDATE_AS_INTERVIEWER/
  )
  await assert.rejects(
    q(`insert into public.interview_participants (organization_id, interview_id, role, panel_role, display_name, email, livekit_identity)
       values ($1, $2, 'INTERVIEWER', 'INTERVIEWER', 'x', 'OUTSIDE.expert@partner.test', 'p_duplicateemail000001')`, [ORG_A, interviewId]),
    /ux_interview_participants_interviewer_email/
  )
  // An email-only interviewer's email can't be swapped afterwards.
  await assert.rejects(
    q(`update public.interview_participants set email = 'other@partner.test' where interview_id = $1 and email = 'noname@partner.test'`, [interviewId]),
    /LIVE_PARTICIPANT_IMMUTABLE/
  )
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

suite("debrief: needs an ended, transcribed interview; AI never sees notes or ratings; notes only for their author", async () => {
  const debrief = await import("@/lib/server/services/live-debrief")
  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  const parts = await q<{ participant_id: string; role: string; user_id: string | null }>(
    `select participant_id::text, role, user_id::text from public.interview_participants where interview_id = $1`, [interviewId]
  )
  const hm = parts.find((p) => p.user_id === hiringManager)!.participant_id
  const cand = parts.find((p) => p.role === "CANDIDATE")!.participant_id
  const prompts: Array<{ system: string; user: string }> = []
  const fakeAi = async (prompt: { system: string; user: string }) => {
    prompts.push(prompt)
    return {
      overview: "The candidate described an order service.",
      competencies: [
        { name: "Backend reliability", level: "STRONG", note: "Concrete figure.", evidence: [{ quote: "handled two thousand requests per second" }] },
        { name: "Leadership", level: "STRONG", note: "Claimed only.", evidence: [{ quote: "I managed fifty people" }] },
      ],
      strengths: [{ point: "Specific throughput number.", evidence: [{ quote: "handled two thousand requests per second" }] }, { point: "We should hire them" }],
      areas_to_probe: [],
      unresolved_questions: ["How was it monitored?"],
      evidence_for_review: [],
    }
  }

  // Not before the interview has ended.
  await assert.rejects(debrief.generateLiveDebrief({ organizationId: ORG_A, interviewId, userId: hiringManager, ai: fakeAi }), { code: "DEBRIEF_NOT_READY" })
  await q(`update public.interviews set live_status = 'COMPLETED', live_started_at = now() - interval '40 minutes', live_ended_at = now() where interview_id = $1`, [interviewId])
  // Not without a transcript.
  await assert.rejects(debrief.generateLiveDebrief({ organizationId: ORG_A, interviewId, userId: hiringManager, ai: fakeAi }), { code: "DEBRIEF_NO_TRANSCRIPT" })
  assert.equal(prompts.length, 0)

  const [recording] = await q<{ id: string }>(
    `insert into public.live_recordings (organization_id, interview_id, participant_id, kind, egress_id, storage_path, status, transcription_status)
     values ($1, $2, $3, 'PARTICIPANT_AUDIO', 'EG_debrief_1', 'veris-live/x/y/a.ogg', 'COMPLETE', 'DONE') returning recording_id::text as id`,
    [ORG_A, interviewId, cand]
  )
  const segment = (startMs: number, text: string) =>
    q(
      `insert into public.live_transcript_segments (organization_id, interview_id, participant_id, recording_id, source, started_at_ms, ended_at_ms, text)
       values ($1, $2, $3, $4, 'POST_TRANSCRIPTION', $5, $6, $7)`,
      [ORG_A, interviewId, cand, recording.id, startMs, startMs + 5000, text]
    )
  await segment(60000, "I built an order service that handled two thousand requests per second.")
  await q(`insert into public.live_interviewer_notes (organization_id, interview_id, participant_id, body) values ($1, $2, $3, 'HM_ONLY_NOTE')`, [ORG_A, interviewId, hm])
  await q(
    `insert into public.live_evaluator_ratings (organization_id, interview_id, participant_id, target_type, rating, evidence, submitted_at)
     values ($1, $2, $3, 'OVERALL', 4, 'HM_RATING_EVIDENCE', now())`,
    [ORG_A, interviewId, hm]
  )
  await q(
    `insert into public.live_interview_events (organization_id, interview_id, participant_id, event_type, payload, occurred_at)
     values ($1, $2, $3, 'SCREEN_SHARE_STARTED', '{}', now() - interval '20 minutes'), ($1, $2, $3, 'SCREEN_SHARE_STOPPED', '{}', now() - interval '10 minutes')`,
    [ORG_A, interviewId, cand]
  )

  const generated = await debrief.generateLiveDebrief({ organizationId: ORG_A, interviewId, userId: hiringManager, ai: fakeAi })
  const prompt = JSON.stringify(prompts[0])
  assert.ok(prompt.includes("two thousand requests"), "the transcript is the input")
  assert.ok(!prompt.includes("HM_ONLY_NOTE"), "private notes are never sent to the AI")
  assert.ok(!prompt.includes("HM_RATING_EVIDENCE"), "interviewer ratings are never sent to the AI")

  const s = generated.summary!
  assert.equal(s.stale, false)
  assert.equal(s.competencies.find((c) => c.name === "Backend reliability")!.level, "STRONG")
  assert.equal(s.competencies.find((c) => c.name === "Leadership")!.level, "PARTIAL", "unverified 'strong' is downgraded")
  assert.deepEqual(s.strengths.map((x) => x.point), ["Specific throughput number."], "verdict dropped")
  assert.ok(!/"(hire|reject|score|verdict)"/i.test(JSON.stringify(s)))
  assert.ok(generated.evidence.screenShare.totalSeconds >= 590 && generated.evidence.screenShare.totalSeconds <= 610)

  // Private notes: the author sees theirs, another interviewer sees none.
  assert.deepEqual(generated.myNotes.map((n) => n.body), ["HM_ONLY_NOTE"])
  const asPanelist = await debrief.getLiveDebrief({ organizationId: ORG_A, interviewId, userId: panelist })
  assert.deepEqual(asPanelist.myNotes, [])
  assert.ok(!JSON.stringify(asPanelist).includes("HM_ONLY_NOTE"))

  // New evidence marks the stored summary stale; regenerating replaces it (one row).
  await segment(90000, "We monitored it with Grafana and PagerDuty alerts.")
  assert.equal((await debrief.getLiveDebrief({ organizationId: ORG_A, interviewId, userId: hiringManager })).summary!.stale, true)
  await debrief.generateLiveDebrief({ organizationId: ORG_A, interviewId, userId: hiringManager, ai: fakeAi })
  const [{ n }] = await q<{ n: number }>(`select count(*)::int as n from public.live_interview_debriefs where interview_id = $1`, [interviewId])
  assert.equal(n, 1)

  // Org-scoped.
  await assert.rejects(debrief.getLiveDebrief({ organizationId: ORG_B, interviewId, userId: userB }), { code: "LIVE_INTERVIEW_NOT_FOUND" })
})

suite("integrity evidence: on the report timeline and in the Debrief, factual, never sent to the AI", async () => {
  const debrief = await import("@/lib/server/services/live-debrief")
  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  const [cand] = await q<{ id: string }>(`select participant_id::text as id from public.interview_participants where interview_id = $1 and role = 'CANDIDATE'`, [interviewId])
  await q(`update public.interviews set live_status = 'COMPLETED', live_started_at = now() - interval '40 minutes', live_ended_at = now() where interview_id = $1`, [interviewId])
  const event = (type: string, minutesAgo: number, payload: Record<string, unknown> = {}) =>
    q(
      `insert into public.live_interview_events (organization_id, interview_id, participant_id, event_type, payload, occurred_at)
       values ($1, $2, $3, $4, $5::jsonb, now() - make_interval(secs => $6))`,
      [ORG_A, interviewId, cand.id, type, JSON.stringify(payload), minutesAgo * 60]
    )
  await event("PARTICIPANT_JOINED", 39, { session: "tag0123456789abc" })
  await event("SCREEN_SHARE_STARTED", 30)
  await event("PAGE_VISIBILITY_HIDDEN", 25)
  await event("PAGE_VISIBILITY_RESTORED", 24, { durationMs: 60_000, reason: "RESOLVED" })
  await event("CAMERA_UNAVAILABLE", 20)
  await event("CAMERA_RESTORED", 19.8, { durationMs: 12_000, reason: "RESOLVED" })
  await event("SCREEN_SHARE_STOPPED", 18)
  await event("FACE_NOT_VISIBLE", 10)
  await event("FACE_NOT_VISIBLE_ENDED", 9, { durationMs: 60_000, reason: "LEFT_ROOM" })
  await q(
    `with r as (
       insert into public.live_recordings (organization_id, interview_id, participant_id, kind, egress_id, storage_path, status, transcription_status)
       values ($1, $2, $3, 'PARTICIPANT_AUDIO', 'EG_integrity_1', 'veris-live/x/y/b.ogg', 'COMPLETE', 'DONE') returning recording_id)
     insert into public.live_transcript_segments (organization_id, interview_id, participant_id, recording_id, source, started_at_ms, ended_at_ms, text)
     select $1, $2, $3, r.recording_id, 'POST_TRANSCRIPTION', 1000, 4000, 'I built the order service and monitored it closely.' from r`,
    [ORG_A, interviewId, cand.id]
  )

  const report = await svc.getLiveInterviewReport({ organizationId: ORG_A, interviewId })
  const line = (type: string) => report.timeline.find((e) => e.type === type)!
  assert.equal(line("CAMERA_UNAVAILABLE").durationSeconds, 12)
  assert.equal(line("PAGE_VISIBILITY_HIDDEN").durationSeconds, 60)
  assert.equal(line("FACE_NOT_VISIBLE").endReason, "LEFT_ROOM")
  assert.equal(line("SCREEN_SHARE_STARTED").durationSeconds, 12 * 60, "existing screen-share events stay on the same timeline")
  assert.ok(!JSON.stringify(report).includes("tag0123456789abc"), "session tags are never exposed")

  const prompts: string[] = []
  const generated = await debrief.generateLiveDebrief({
    organizationId: ORG_A,
    interviewId,
    userId: hiringManager,
    ai: async (prompt) => {
      prompts.push(JSON.stringify(prompt))
      return { overview: "Discussed an order service.", competencies: [], strengths: [], areas_to_probe: [], unresolved_questions: [], evidence_for_review: [] }
    },
  })
  assert.deepEqual(generated.evidence.integrity.counts, { faceNotVisible: 1, multipleFaces: 0, cameraUnavailable: 1, pageHidden: 1, screenShares: 1, sessionChanges: 0 })
  assert.deepEqual(
    generated.evidence.integrity.timeline.map((e) => e.type),
    ["SCREEN_SHARE_STARTED", "PAGE_VISIBILITY_HIDDEN", "PAGE_VISIBILITY_RESTORED", "CAMERA_UNAVAILABLE", "CAMERA_RESTORED", "SCREEN_SHARE_STOPPED", "FACE_NOT_VISIBLE"]
  )
  assert.ok(!/FACE_NOT|CAMERA_|PAGE_VISIBILITY|SCREEN_SHARE|visibility|camera/i.test(prompts[0]), "integrity evidence never reaches the AI")
  assert.ok(!/score|verdict|cheat|suspic/i.test(JSON.stringify(generated.evidence.integrity)))
})

suite("abandoned sessions: completed only after the slot, when idle and LiveKit says the room is empty", async () => {
  const create = async () => (await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })).interviewId
  const setRunning = (id: string, startedMinutesAgo: number) =>
    q(`update public.interviews set live_status = 'IN_PROGRESS', live_started_at = now() - make_interval(mins => $2), duration_minutes = 45 where interview_id = $1`, [id, startedMinutesAgo])
  const status = async (id: string) => (await q<{ live_status: string }>(`select live_status from public.interviews where interview_id = $1`, [id]))[0].live_status
  const roomWith = (people: number | Error) => ({
    removeParticipant: async () => {},
    deleteRoom: async () => {},
    countParticipants: async () => {
      if (people instanceof Error) throw people
      return people
    },
  })

  const inSlot = await create()
  await setRunning(inSlot, 30)
  const someoneThere = await create()
  await setRunning(someoneThere, 120)
  const recentlyActive = await create()
  await setRunning(recentlyActive, 120)
  const [cand] = await q<{ id: string }>(`select participant_id::text as id from public.interview_participants where interview_id = $1 and role = 'CANDIDATE'`, [recentlyActive])
  await q(`insert into public.live_interview_events (organization_id, interview_id, participant_id, event_type, occurred_at) values ($1, $2, $3, 'PARTICIPANT_LEFT', now() - interval '5 minutes')`, [ORG_A, recentlyActive, cand.id])

  // Someone is still in the room: left alone, however late.
  assert.deepEqual(await svc.completeAbandonedSessions(ORG_A, roomWith(1)), { completed: 0 })
  assert.equal(await status(someoneThere), "IN_PROGRESS")

  // Empty room: only the session past its slot and idle for 15 minutes is completed.
  const abandoned = await create()
  await setRunning(abandoned, 180)
  const [abandonedCand] = await q<{ id: string }>(`select participant_id::text as id from public.interview_participants where interview_id = $1 and role = 'CANDIDATE'`, [abandoned])
  await q(`update public.interview_participants set join_status = 'JOINED' where interview_id = $1`, [abandoned])
  await q(`insert into public.live_interview_events (organization_id, interview_id, participant_id, event_type, occurred_at) values ($1, $2, $3, 'PARTICIPANT_LEFT', now() - interval '130 minutes')`, [ORG_A, abandoned, abandonedCand.id])
  // Another organization's sweep never touches these.
  assert.deepEqual(await svc.completeAbandonedSessions(ORG_B, roomWith(0)), { completed: 0 })
  assert.equal(await status(abandoned), "IN_PROGRESS", "other organizations can't complete it")

  const result = await svc.completeAbandonedSessions(ORG_A, roomWith(0))
  assert.equal(await status(inSlot), "IN_PROGRESS", "still inside its slot")
  assert.equal(await status(recentlyActive), "IN_PROGRESS", "someone left 5 minutes ago")
  assert.equal(await status(abandoned), "COMPLETED")
  assert.equal(await status(someoneThere), "COMPLETED", "now empty too")
  assert.equal(result.completed, 2)

  const [ended] = await q<{ ended_ok: boolean }>(
    `select abs(extract(epoch from live_ended_at - (now() - interval '130 minutes'))) < 5 as ended_ok from public.interviews where interview_id = $1`,
    [abandoned]
  )
  assert.ok(ended.ended_ok, "ends when the room last saw someone leave")
  const people = await q<{ role: string; join_status: string; has_link: boolean }>(
    `select role, join_status, invite_token_hash is not null as has_link from public.interview_participants where interview_id = $1`,
    [abandoned]
  )
  assert.ok(people.every((p) => p.join_status !== "JOINED"))
  assert.equal(people.find((p) => p.role === "CANDIDATE")?.has_link, false, "the candidate's link closes")
  const [event] = await q<{ reason: string }>(
    `select payload->>'reason' as reason from public.live_interview_events where interview_id = $1 and event_type = 'SESSION_COMPLETED'`,
    [abandoned]
  )
  assert.equal(event.reason, "ROOM_EMPTY")

  // LiveKit unreachable or not configured: only once 6 hours past the slot.
  const veryOld = await create()
  await setRunning(veryOld, 8 * 60)
  const lateButRecent = await create()
  await setRunning(lateButRecent, 120)
  await svc.completeAbandonedSessions(ORG_A, roomWith(new Error("LiveKit unavailable")))
  assert.equal(await status(lateButRecent), "IN_PROGRESS")
  assert.equal(await status(veryOld), "COMPLETED")
  const [fallback] = await q<{ reason: string }>(`select payload->>'reason' as reason from public.live_interview_events where interview_id = $1 and event_type = 'SESSION_COMPLETED'`, [veryOld])
  assert.equal(fallback.reason, "ABANDONED")
  assert.equal((await svc.completeAbandonedSessions(ORG_A, null)).completed, 0)
  assert.equal(await status(lateButRecent), "IN_PROGRESS")
})

suite("dashboard alerts: VERIS Live Interviews raise started and completed alerts", async () => {
  const alerts = await import("@/lib/server/services/dashboard-alerts")
  // Columns the existing AI-alert query reads that the focus fixture doesn't carry (production has both, as text).
  await q(`alter table public.interview_attempts add column if not exists interruption_reason text`)
  await q(`alter table public.interviews add column if not exists final_status text`)
  const { interviewId } = await svc.createLiveInterview({ organizationId: ORG_A, userId: hiringManager, input: input({ sendInvitations: false }), deps })
  const live = async () => (await alerts.getDashboardAlerts(ORG_A, "all")).filter((a) => a.id.startsWith(interviewId))

  assert.deepEqual(await live(), [], "nothing before it starts")
  await q(`update public.interviews set live_status = 'IN_PROGRESS', live_started_at = now() where interview_id = $1`, [interviewId])
  const started = await live()
  assert.deepEqual(started.map((a) => [a.type, a.title, a.tone]), [["LIVE_INTERVIEW_STARTED", "VERIS Live Interview started", "info"]])
  await q(`update public.interviews set live_status = 'COMPLETED', live_ended_at = now() where interview_id = $1`, [interviewId])
  const completed = await live()
  assert.deepEqual(completed.map((a) => [a.type, a.tone]), [["LIVE_INTERVIEW_COMPLETED", "success"]])
  assert.match(completed[0].message, /VERIS Live Interview/)

  // Read state works per alert, like AI interview alerts.
  await alerts.markDashboardAlertsRead({ organizationId: ORG_A, userId: hiringManager, alertIds: [completed[0].id] })
  assert.deepEqual((await alerts.getDashboardAlerts(ORG_A, "all", hiringManager)).filter((a) => a.id.startsWith(interviewId)), [])
  assert.deepEqual((await alerts.getDashboardAlerts(ORG_B, "all")).filter((a) => a.id.startsWith(interviewId)), [], "scoped to the organization")
})
