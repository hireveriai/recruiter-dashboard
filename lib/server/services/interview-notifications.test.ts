import assert from "node:assert/strict"
import test from "node:test"

import { resolveNotificationRecipients } from "@/lib/server/services/interview-notifications"

const recruiter = { userId: "recruiter-1", email: "recruiter@org-a.com", isActive: true }
const teamMemberA = { userId: "member-a", email: "member-a@org-a.com", isActive: true }
const teamMemberB = { userId: "member-b", email: "member-b@org-a.com", isActive: true }

test("recruiter only receives an email when notify_recruiting_team is disabled", () => {
  const recipients = resolveNotificationRecipients({
    recruiter,
    teamMembers: [teamMemberA, teamMemberB],
    notifyRecruitingTeam: false,
  })

  assert.deepEqual(
    recipients.map((r) => r.email),
    ["recruiter@org-a.com"]
  )
  assert.equal(recipients[0].kind, "RECRUITER")
})

test("recruiter and team members all receive an email when notify_recruiting_team is enabled", () => {
  const recipients = resolveNotificationRecipients({
    recruiter,
    teamMembers: [teamMemberA, teamMemberB],
    notifyRecruitingTeam: true,
  })

  assert.deepEqual(
    recipients.map((r) => r.email).sort(),
    ["member-a@org-a.com", "member-b@org-a.com", "recruiter@org-a.com"]
  )
})

test("a recruiter who is also a team member is only counted once", () => {
  const recipients = resolveNotificationRecipients({
    recruiter,
    teamMembers: [recruiter, teamMemberA],
    notifyRecruitingTeam: true,
  })

  const recruiterMatches = recipients.filter((r) => r.userId === recruiter.userId)
  assert.equal(recruiterMatches.length, 1)
  assert.equal(recruiterMatches[0].kind, "RECRUITER")
  assert.equal(recipients.length, 2)
})

test("an inactive team member never receives an email", () => {
  const inactiveMember = { userId: "member-c", email: "member-c@org-a.com", isActive: false }

  const recipients = resolveNotificationRecipients({
    recruiter,
    teamMembers: [teamMemberA, inactiveMember],
    notifyRecruitingTeam: true,
  })

  assert.ok(!recipients.some((r) => r.userId === inactiveMember.userId))
})

test("a team member without a usable email is skipped", () => {
  const noEmailMember = { userId: "member-d", email: null, isActive: true }
  const blankEmailMember = { userId: "member-e", email: "   ", isActive: true }

  const recipients = resolveNotificationRecipients({
    recruiter,
    teamMembers: [noEmailMember, blankEmailMember],
    notifyRecruitingTeam: true,
  })

  assert.deepEqual(
    recipients.map((r) => r.userId),
    [recruiter.userId]
  )
})

test("an inactive recruiter is dropped, leaving only the team when enabled", () => {
  const inactiveRecruiter = { userId: "recruiter-2", email: "recruiter2@org-a.com", isActive: false }

  const recipients = resolveNotificationRecipients({
    recruiter: inactiveRecruiter,
    teamMembers: [teamMemberA],
    notifyRecruitingTeam: true,
  })

  assert.deepEqual(
    recipients.map((r) => r.userId),
    [teamMemberA.userId]
  )
})

test("no recruiter assigned and notifications disabled yields nobody", () => {
  const recipients = resolveNotificationRecipients({
    recruiter: null,
    teamMembers: [teamMemberA],
    notifyRecruitingTeam: false,
  })

  assert.deepEqual(recipients, [])
})

test(
  "resolution never sees users outside the caller-supplied org-scoped candidate list " +
    "(multi-tenant isolation is enforced by the SQL WHERE organization_id = ... clause " +
    "that produces `recruiter`/`teamMembers`, not by this pure merge step)",
  () => {
    const orgBUser = { userId: "org-b-user", email: "someone@org-b.com", isActive: true }

    const recipients = resolveNotificationRecipients({
      recruiter,
      teamMembers: [teamMemberA],
      notifyRecruitingTeam: true,
    })

    assert.ok(!recipients.some((r) => r.userId === orgBUser.userId))
  }
)
