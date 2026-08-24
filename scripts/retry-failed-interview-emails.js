#!/usr/bin/env node
/**
 * Lists interviews whose invite email failed, and optionally replays them
 * through the recruiter retry-email API.
 *
 * Usage:
 *   node scripts/retry-failed-interview-emails.js                 # list only (safe)
 *   node scripts/retry-failed-interview-emails.js --send          # replay eligible rows
 *   node scripts/retry-failed-interview-emails.js --send --id <interviewId>
 *
 * Env:
 *   DATABASE_URL           read from .env.local by Prisma as usual
 *   RECRUITER_BASE_URL     defaults to https://recruiter.verisnova.com
 *   RECRUITER_SESSION      value of the hireveri_session cookie for a recruiter
 *                          in the owning organization (required with --send)
 *
 * Only interviews with status READY and question_status COMPLETED can be
 * replayed -- sendInterviewEmailForInterview rejects anything else with 409.
 */

const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

const BASE_URL = (process.env.RECRUITER_BASE_URL || "https://recruiter.verisnova.com").replace(/\/$/, "")
const SEND = process.argv.includes("--send")
const ID_FLAG_INDEX = process.argv.indexOf("--id")
const ONLY_ID = ID_FLAG_INDEX !== -1 ? process.argv[ID_FLAG_INDEX + 1] : null

async function loadFailedInterviews() {
  return prisma.$queryRawUnsafe(`
    select
      i.interview_id::text   as interview_id,
      i.organization_id::text as organization_id,
      c.email                as candidate_email,
      i.status,
      i.question_status,
      i.created_at,
      i.last_error
    from public.interviews i
    left join public.candidates c on c.candidate_id = i.candidate_id
    where i.email_status = 'FAILED'
      ${ONLY_ID ? "and i.interview_id = $1::uuid" : ""}
    order by i.created_at desc
  `, ...(ONLY_ID ? [ONLY_ID] : []))
}

function isReplayable(row) {
  return String(row.status).toUpperCase() === "READY"
    && String(row.question_status).toUpperCase() === "COMPLETED"
}

async function retryOne(interviewId, sessionCookie) {
  const response = await fetch(`${BASE_URL}/api/interview/${interviewId}/retry-email`, {
    method: "POST",
    headers: { cookie: `hireveri_session=${sessionCookie}` },
  })

  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

async function main() {
  const rows = await loadFailedInterviews()

  if (rows.length === 0) {
    console.log("No interviews with email_status = FAILED.")
    return
  }

  console.log(`${rows.length} failed invite email(s):\n`)
  for (const row of rows) {
    const flag = isReplayable(row) ? "replayable" : `skip (status=${row.status})`
    console.log(`  ${row.interview_id}  ${row.candidate_email || "<no email>"}  [${flag}]`)
    console.log(`    ${row.created_at.toISOString()}  ${String(row.last_error || "").slice(0, 120)}`)
  }

  const replayable = rows.filter(isReplayable)

  if (!SEND) {
    console.log(`\n${replayable.length} replayable. Re-run with --send to replay them.`)
    return
  }

  const sessionCookie = process.env.RECRUITER_SESSION
  if (!sessionCookie) {
    console.error("\nRECRUITER_SESSION is required with --send (hireveri_session cookie value).")
    process.exitCode = 1
    return
  }

  console.log(`\nReplaying ${replayable.length} invite email(s) against ${BASE_URL}...\n`)
  for (const row of replayable) {
    const result = await retryOne(row.interview_id, sessionCookie)
    const sent = result.body?.data?.emailSent ?? result.body?.emailSent
    const detail = sent ? "SENT" : (result.body?.data?.emailError || result.body?.error?.message || `HTTP ${result.status}`)
    console.log(`  ${row.interview_id}  ${row.candidate_email}  ->  ${detail}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
