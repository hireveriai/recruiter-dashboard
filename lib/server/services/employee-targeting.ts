import { Prisma } from "@prisma/client"
import type { z } from "zod"

import { buildAssessmentUrl, createInviteToken } from "@/lib/server/assessment/invite-link"
import type { assessmentTargetSchema, listAssignmentsQuerySchema } from "@/lib/server/employees/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { getAssessmentCreditSnapshot } from "@/lib/server/services/assessment-credits"
import { sendAssessmentInvitationEmailBatch } from "@/lib/services/email.service"

/**
 * Employee assessment targeting: assign one published Employee assessment to
 * a set of employees described by a rule (a department, a project, both, or
 * an explicit selection) instead of picking people one by one.
 *
 * All matching happens in the database — the browser only ever receives
 * counts and one page of names, however large the department is.
 *
 * Assignment records are the existing assessment_invites rows (one per
 * employee, carrying the emailed token). Duplicate protection is two-layer:
 *   1. employees who already hold a live (non-cancelled) invite for the
 *      assessment are excluded before anything is written, and
 *   2. the partial unique index uq_assessment_invites_assessment_employee
 *      plus INSERT ... ON CONFLICT DO NOTHING makes a concurrent double
 *      submit harmless: only invites that were really inserted get emailed.
 */

export type AssessmentTargetInput = z.output<typeof assessmentTargetSchema>
type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>

const INSERT_CHUNK = 500

export function describeTarget(
  targetType: string,
  department: { name: string } | null | undefined,
  project: { name: string } | null | undefined
) {
  if (targetType === "DEPARTMENT_PROJECT") return `${department?.name ?? "Department"} / ${project?.name ?? "Project"}`
  if (targetType === "DEPARTMENT") return department?.name ?? "Department"
  if (targetType === "PROJECT") return project?.name ?? "Project"
  return "Selected employees"
}

async function loadEmployeeAssessment(organizationId: string, assessmentId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, organizationId },
  })
  if (!assessment) {
    throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
  }
  if (assessment.participantType !== "EMPLOYEE") {
    throw new ApiError(409, "NOT_AN_EMPLOYEE_ASSESSMENT", "Only employee assessments can be assigned to employees")
  }
  return assessment
}

/**
 * The department/project in a target must belong to this organization and be
 * active. A deactivated department or project cannot be targeted, though
 * everything already assigned through it is kept.
 */
async function resolveScope(organizationId: string, target: AssessmentTargetInput) {
  const [department, project] = await Promise.all([
    target.departmentId
      ? prisma.department.findFirst({
          where: { id: target.departmentId, organizationId },
          select: { id: true, name: true, status: true },
        })
      : Promise.resolve(null),
    target.projectId
      ? prisma.project.findFirst({
          where: { id: target.projectId, organizationId },
          select: { id: true, name: true, code: true, status: true },
        })
      : Promise.resolve(null),
  ])

  if (target.departmentId && !department) {
    throw new ApiError(404, "DEPARTMENT_NOT_FOUND", "Department not found for this organization")
  }
  if (target.projectId && !project) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found for this organization")
  }
  if (department && department.status !== "ACTIVE") {
    throw new ApiError(409, "DEPARTMENT_INACTIVE", `${department.name} is inactive and cannot be targeted`)
  }
  if (project && project.status !== "ACTIVE") {
    throw new ApiError(409, "PROJECT_INACTIVE", `${project.name} is inactive and cannot be targeted`)
  }

  return { department, project }
}

/** WHERE clause over `public.employees e` selecting the target's eligible (active) employees. */
export function eligibleEmployeesWhere(organizationId: string, target: AssessmentTargetInput) {
  const parts: Prisma.Sql[] = [Prisma.sql`e.organization_id = ${organizationId}::uuid`, Prisma.sql`e.status = 'ACTIVE'`]

  if (target.departmentId) {
    parts.push(Prisma.sql`e.department_id = ${target.departmentId}::uuid`)
  }
  if (target.projectId) {
    parts.push(Prisma.sql`exists (
      select 1 from public.employee_projects ep
      where ep.organization_id = e.organization_id
        and ep.project_id = ${target.projectId}::uuid
        and ep.employee_id = e.id
    )`)
  }
  if (target.targetType === "INDIVIDUAL") {
    parts.push(Prisma.sql`e.id = any(${target.employeeIds}::uuid[])`)
  }

  return Prisma.join(parts, " and ")
}

/** Lateral join exposing `live.status` — the employee's live invite for this assessment, if any. */
function liveInviteJoin(organizationId: string, assessmentId: string) {
  return Prisma.sql`
    left join lateral (
      select i.id, i.status
      from public.assessment_invites i
      where i.assessment_id = ${assessmentId}::uuid
        and i.organization_id = ${organizationId}::uuid
        and i.employee_id = e.id
        and i.status <> 'CANCELLED'
      order by i.created_at desc
      limit 1
    ) live on true
  `
}

async function countTarget(organizationId: string, assessmentId: string, target: AssessmentTargetInput) {
  const rows = await prisma.$queryRaw<{ matched: number; already_assigned: number; already_completed: number }[]>(Prisma.sql`
    select count(*)::int as matched,
           count(live.id)::int as already_assigned,
           count(*) filter (where live.status = 'COMPLETED')::int as already_completed
    from public.employees e
    ${liveInviteJoin(organizationId, assessmentId)}
    where ${eligibleEmployeesWhere(organizationId, target)}
  `)
  const row = rows[0] ?? { matched: 0, already_assigned: 0, already_completed: 0 }
  return {
    matched: Number(row.matched),
    alreadyAssigned: Number(row.already_assigned),
    alreadyCompleted: Number(row.already_completed),
    newAssignments: Number(row.matched) - Number(row.already_assigned),
  }
}

/**
 * For an explicit selection, explains ids that did not match: employees who
 * are inactive, and ids that are not employees of this organization at all
 * (another tenant's id is indistinguishable from a made-up one).
 */
async function explainIndividualSelection(organizationId: string, employeeIds: string[]) {
  if (employeeIds.length === 0) return { requested: 0, inactive: 0, notFound: 0 }
  const rows = await prisma.$queryRaw<{ found: number; inactive: number }[]>(Prisma.sql`
    select count(*)::int as found,
           count(*) filter (where e.status <> 'ACTIVE')::int as inactive
    from public.employees e
    where e.organization_id = ${organizationId}::uuid and e.id = any(${employeeIds}::uuid[])
  `)
  const found = Number(rows[0]?.found ?? 0)
  return { requested: employeeIds.length, inactive: Number(rows[0]?.inactive ?? 0), notFound: employeeIds.length - found }
}

type PreviewEmployeeRow = {
  id: string
  employee_code: string | null
  full_name: string
  email: string
  title: string | null
  department_name: string | null
  assignment_status: string | null
}

export async function previewAssessmentTarget(
  organizationId: string,
  assessmentId: string,
  target: AssessmentTargetInput,
  page: number,
  pageSize: number
) {
  const assessment = await loadEmployeeAssessment(organizationId, assessmentId)
  const scope = await resolveScope(organizationId, target)

  const [counts, selection, rows] = await Promise.all([
    countTarget(organizationId, assessmentId, target),
    target.targetType === "INDIVIDUAL" ? explainIndividualSelection(organizationId, target.employeeIds) : Promise.resolve(null),
    prisma.$queryRaw<PreviewEmployeeRow[]>(Prisma.sql`
      select e.id::text, e.employee_code, e.full_name, e.email, e.title,
             d.name as department_name, live.status as assignment_status
      from public.employees e
      left join public.departments d on d.organization_id = e.organization_id and d.id = e.department_id
      ${liveInviteJoin(organizationId, assessmentId)}
      where ${eligibleEmployeesWhere(organizationId, target)}
      order by lower(e.full_name), e.id
      limit ${pageSize} offset ${(page - 1) * pageSize}
    `),
  ])

  const sendBlockedReason =
    assessment.status !== "PUBLISHED" || !assessment.activeVersionId
      ? "Publish this assessment before assigning it."
      : counts.matched === 0
        ? "No active employees match this target."
        : counts.newAssignments === 0
          ? "Every matching employee already has this assessment."
          : null

  return {
    assessment: { id: assessment.id, title: assessment.title, status: assessment.status },
    target: {
      targetType: target.targetType,
      label: describeTarget(target.targetType, scope.department, scope.project),
      department: scope.department ? { id: scope.department.id, name: scope.department.name } : null,
      project: scope.project ? { id: scope.project.id, name: scope.project.name, code: scope.project.code } : null,
    },
    counts,
    selection,
    canSend: sendBlockedReason === null,
    sendBlockedReason,
    employees: rows.map((row) => ({
      id: row.id,
      employeeCode: row.employee_code,
      fullName: row.full_name,
      email: row.email,
      title: row.title,
      department: row.department_name,
      assignmentStatus: row.assignment_status,
      alreadyAssigned: row.assignment_status !== null,
    })),
    meta: { page, pageSize, total: counts.matched, totalPages: Math.max(1, Math.ceil(counts.matched / pageSize)) },
  }
}

/**
 * Creates one invite per newly matched employee and emails each one through
 * the existing assessment invitation email. Safe to call twice with the same
 * target: the second call assigns nobody new.
 */
export async function assignAssessmentToTarget(
  auth: { organizationId: string; userId: string },
  assessmentId: string,
  target: AssessmentTargetInput
) {
  const { organizationId } = auth
  const assessment = await loadEmployeeAssessment(organizationId, assessmentId)

  // Only a PUBLISHED assessment's finalized active version may ever reach a
  // participant (same rule as the single invite route).
  if (assessment.status !== "PUBLISHED" || !assessment.activeVersionId) {
    throw new ApiError(409, "ASSESSMENT_NOT_PUBLISHED", "Publish this assessment before assigning it.")
  }
  const versionId = assessment.activeVersionId
  const scope = await resolveScope(organizationId, target)

  const recipients = await prisma.$queryRaw<{ id: string; email: string; full_name: string }[]>(Prisma.sql`
    select e.id::text, e.email, e.full_name
    from public.employees e
    ${liveInviteJoin(organizationId, assessmentId)}
    where ${eligibleEmployeesWhere(organizationId, target)}
      and live.id is null
    order by e.id
  `)
  const counts = await countTarget(organizationId, assessmentId, target)

  if (counts.matched === 0) {
    throw new ApiError(409, "NO_MATCHING_EMPLOYEES", "No active employees match this target.")
  }

  const targetSummary = {
    targetType: target.targetType,
    label: describeTarget(target.targetType, scope.department, scope.project),
  }

  // Everyone matching already has it (e.g. a double-clicked Send): nothing
  // to write, nothing to email.
  if (recipients.length === 0) {
    return {
      targetId: null,
      target: targetSummary,
      matched: counts.matched,
      alreadyAssigned: counts.matched,
      assigned: 0,
      emailsSent: 0,
      emailsFailed: 0,
      emailError: null,
      failedRecipients: [],
      creditWarning: null,
    }
  }

  const expiresAt = new Date(Date.now() + assessment.linkExpiryDays * 24 * 60 * 60 * 1000)
  const tokens = recipients.map((recipient) => ({ recipient, ...createInviteToken() }))

  const { targetId, created } = await prisma.$transaction(
    async (tx) => {
      const targetRow = await tx.assessmentTarget.create({
        data: {
          organizationId,
          assessmentId,
          targetType: target.targetType,
          departmentId: target.departmentId,
          projectId: target.projectId,
          matchedCount: counts.matched,
          createdBy: auth.userId,
        },
      })

      const inserted: { id: string; employeeId: string; tokenHash: string }[] = []
      for (let start = 0; start < tokens.length; start += INSERT_CHUNK) {
        const chunk = tokens.slice(start, start + INSERT_CHUNK)
        // ON CONFLICT DO NOTHING: an invite that a concurrent request created
        // for the same employee in the meantime wins; this one is dropped.
        await tx.assessmentInvite.createMany({
          data: chunk.map(({ recipient, tokenHash }) => ({
            assessmentId,
            versionId,
            jobId: assessment.jobId,
            employeeId: recipient.id,
            organizationId,
            tokenHash,
            status: "INVITED",
            expiresAt,
            createdBy: auth.userId,
            targetId: targetRow.id,
          })),
          skipDuplicates: true,
        })
        const rows = await tx.assessmentInvite.findMany({
          where: { tokenHash: { in: chunk.map((item) => item.tokenHash) } },
          select: { id: true, employeeId: true, tokenHash: true },
        })
        inserted.push(...rows.map((row) => ({ id: row.id, employeeId: row.employeeId!, tokenHash: row.tokenHash })))
      }

      await tx.assessmentTarget.update({
        where: { id: targetRow.id },
        data: { assignedCount: inserted.length, alreadyAssignedCount: counts.matched - inserted.length },
      })

      return { targetId: targetRow.id, created: inserted }
    },
    { timeout: 60_000 }
  )

  // Emails go out after commit, so a mail failure never rolls back an
  // assignment (and a retry of the send can't create duplicates).
  const [job, organization] = await Promise.all([
    assessment.jobId
      ? prisma.jobPosition.findFirst({ where: { jobId: assessment.jobId, organizationId }, select: { jobTitle: true } })
      : Promise.resolve(null),
    prisma.organization.findUnique({ where: { organizationId }, select: { organizationName: true } }),
  ])

  const createdHashes = new Set(created.map((row) => row.tokenHash))
  const inviteIdByHash = new Map(created.map((row) => [row.tokenHash, row.id]))
  const toEmail = tokens.filter((item) => createdHashes.has(item.tokenHash))

  const delivery = await sendAssessmentInvitationEmailBatch(
    toEmail.map(({ recipient, token }) => ({
      to: recipient.email,
      candidateName: recipient.full_name,
      jobTitle: job?.jobTitle ?? "the open role",
      assessmentTitle: assessment.title,
      durationMinutes: assessment.durationMinutes,
      expiresAt,
      assessmentUrl: buildAssessmentUrl(token),
      companyName: organization?.organizationName ?? null,
      activityType: assessment.activityType as "ASSESSMENT" | "CHALLENGE" | "TASK",
      participantType: "EMPLOYEE",
    }))
  )

  // sent_at records actual delivery to the email provider; invites whose
  // email failed keep sent_at null.
  const sentInviteIds = delivery.sentIndexes.map((index) => inviteIdByHash.get(toEmail[index].tokenHash)!)
  if (sentInviteIds.length) {
    await prisma.assessmentInvite.updateMany({
      where: { id: { in: sentInviteIds }, organizationId },
      data: { sentAt: new Date() },
    })
  }
  if (delivery.failed.length) {
    console.error("Assessment targeting: invitation emails failed", {
      assessmentId,
      targetId,
      failed: delivery.failed.length,
      error: delivery.failed[0]?.error,
    })
  }

  let creditWarning: string | null = null
  try {
    const snapshot = await getAssessmentCreditSnapshot(organizationId)
    if (!snapshot.canRunAssessment) {
      creditWarning =
        "This workspace has no VERIS Assessment credits remaining. The assignments were created, but completed assessments may fail to score until credits are available."
    }
  } catch (error) {
    console.warn("Assessment credit pre-check failed", error)
  }

  return {
    targetId,
    target: targetSummary,
    matched: counts.matched,
    alreadyAssigned: counts.matched - created.length,
    assigned: created.length,
    emailsSent: delivery.sentIndexes.length,
    emailsFailed: delivery.failed.length,
    emailError: delivery.failed[0]?.error ?? null,
    failedRecipients: delivery.failed.slice(0, 20).map(({ index }) => toEmail[index].recipient.email),
    creditWarning,
  }
}

// Dashboard / results ------------------------------------------------------------

type StatsRow = {
  assessment_id: string
  assigned: number
  completed: number
  avg_score: string | null
  passed: number
  graded: number
}

/**
 * Assigned / Completed / Pending / Average score / Pass rate per employee
 * assessment. `managerUserId` narrows the numbers to that manager's direct
 * reports (callers without org-wide employeeActivities.manage).
 */
export async function getEmployeeAssessmentStats(
  organizationId: string,
  assessmentIds: string[],
  managerUserId: string | null
) {
  const stats = new Map<
    string,
    { assigned: number; completed: number; pending: number; averageScore: number | null; passRate: number | null }
  >()
  if (assessmentIds.length === 0) return stats

  const rows = await prisma.$queryRaw<StatsRow[]>(Prisma.sql`
    select i.assessment_id::text,
           count(*)::int as assigned,
           count(*) filter (where i.status = 'COMPLETED')::int as completed,
           avg(r.percentage)::text as avg_score,
           count(*) filter (where r.passed is true)::int as passed,
           count(r.passed)::int as graded
    from public.assessment_invites i
    left join public.assessment_attempts a on a.invite_id = i.id
    left join public.assessment_results r on r.attempt_id = a.id
    ${managerUserId ? Prisma.sql`join public.employees e on e.id = i.employee_id and e.organization_id = i.organization_id` : Prisma.empty}
    where i.organization_id = ${organizationId}::uuid
      and i.assessment_id = any(${assessmentIds}::uuid[])
      and i.employee_id is not null
      and i.status <> 'CANCELLED'
      ${managerUserId ? Prisma.sql`and e.manager_user_id = ${managerUserId}::uuid` : Prisma.empty}
    group by i.assessment_id
  `)

  for (const row of rows) {
    const assigned = Number(row.assigned)
    const completed = Number(row.completed)
    const graded = Number(row.graded)
    stats.set(row.assessment_id, {
      assigned,
      completed,
      pending: assigned - completed,
      averageScore: row.avg_score === null ? null : Math.round(Number(row.avg_score) * 10) / 10,
      passRate: graded > 0 ? Math.round((Number(row.passed) / graded) * 1000) / 10 : null,
    })
  }
  return stats
}

/** Latest target label per assessment (plus how many targeted sends there were). */
export async function getLatestTargets(organizationId: string, assessmentIds: string[]) {
  const labels = new Map<string, { label: string; targetType: string; sends: number }>()
  if (assessmentIds.length === 0) return labels

  const rows = await prisma.$queryRaw<
    { assessment_id: string; target_type: string; department_name: string | null; project_name: string | null; sends: number }[]
  >(Prisma.sql`
    select distinct on (t.assessment_id)
           t.assessment_id::text, t.target_type, d.name as department_name, p.name as project_name,
           count(*) over (partition by t.assessment_id)::int as sends
    from public.assessment_targets t
    left join public.departments d on d.organization_id = t.organization_id and d.id = t.department_id
    left join public.projects p on p.organization_id = t.organization_id and p.id = t.project_id
    where t.organization_id = ${organizationId}::uuid
      and t.assessment_id = any(${assessmentIds}::uuid[])
    order by t.assessment_id, t.created_at desc
  `)

  for (const row of rows) {
    labels.set(row.assessment_id, {
      label: describeTarget(
        row.target_type,
        row.department_name ? { name: row.department_name } : null,
        row.project_name ? { name: row.project_name } : null
      ),
      targetType: row.target_type,
      sends: Number(row.sends),
    })
  }
  return labels
}

type AssignmentRow = {
  invite_id: string
  invite_status: string
  assigned_at: Date
  sent_at: Date | null
  expires_at: Date
  employee_id: string
  employee_code: string | null
  full_name: string
  email: string
  employee_status: string
  department_name: string | null
  attempt_id: string | null
  attempt_status: string | null
  percentage: string | null
  passed: boolean | null
  completed_at: Date | null
  target_type: string | null
}

/** Employee-level assignment status and results for one employee assessment, paginated. */
export async function listAssessmentAssignments(
  organizationId: string,
  assessmentId: string,
  query: ListAssignmentsQuery,
  managerUserId: string | null
) {
  const assessment = await loadEmployeeAssessment(organizationId, assessmentId)

  const filters: Prisma.Sql[] = [
    Prisma.sql`i.organization_id = ${organizationId}::uuid`,
    Prisma.sql`i.assessment_id = ${assessmentId}::uuid`,
    Prisma.sql`i.employee_id is not null`,
    Prisma.sql`i.status <> 'CANCELLED'`,
  ]
  if (managerUserId) filters.push(Prisma.sql`e.manager_user_id = ${managerUserId}::uuid`)
  if (query.status === "COMPLETED") filters.push(Prisma.sql`i.status = 'COMPLETED'`)
  if (query.status === "PENDING") filters.push(Prisma.sql`i.status <> 'COMPLETED'`)
  if (query.search) {
    const like = `%${query.search}%`
    filters.push(Prisma.sql`(e.full_name ilike ${like} or e.email ilike ${like} or e.employee_code ilike ${like})`)
  }
  const where = Prisma.join(filters, " and ")
  const from = Prisma.sql`
    from public.assessment_invites i
    join public.employees e on e.organization_id = i.organization_id and e.id = i.employee_id
  `

  const [totalRows, rows, stats, targets] = await Promise.all([
    prisma.$queryRaw<{ total: number }[]>(Prisma.sql`select count(*)::int as total ${from} where ${where}`),
    prisma.$queryRaw<AssignmentRow[]>(Prisma.sql`
      select i.id::text as invite_id, i.status as invite_status, i.created_at as assigned_at, i.sent_at, i.expires_at,
             e.id::text as employee_id, e.employee_code, e.full_name, e.email, e.status as employee_status,
             d.name as department_name,
             a.id::text as attempt_id, a.status as attempt_status,
             r.percentage::text, r.passed, coalesce(r.completed_at, i.completed_at) as completed_at,
             t.target_type
      ${from}
      left join public.departments d on d.organization_id = e.organization_id and d.id = e.department_id
      left join public.assessment_attempts a on a.invite_id = i.id
      left join public.assessment_results r on r.attempt_id = a.id
      left join public.assessment_targets t on t.id = i.target_id
      where ${where}
      order by i.created_at desc, i.id
      limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
    `),
    getEmployeeAssessmentStats(organizationId, [assessmentId], managerUserId),
    getLatestTargets(organizationId, [assessmentId]),
  ])

  const total = Number(totalRows[0]?.total ?? 0)
  return {
    assessment: {
      id: assessment.id,
      title: assessment.title,
      status: assessment.status,
      activityType: assessment.activityType,
      passingPercentage: assessment.passingPercentage,
      durationMinutes: assessment.durationMinutes,
      createdAt: assessment.createdAt,
    },
    summary: stats.get(assessmentId) ?? { assigned: 0, completed: 0, pending: 0, averageScore: null, passRate: null },
    target: targets.get(assessmentId) ?? null,
    assignments: rows.map((row) => ({
      inviteId: row.invite_id,
      inviteStatus: row.invite_status,
      assignedAt: row.assigned_at,
      sentAt: row.sent_at,
      expiresAt: row.expires_at,
      expired: new Date(row.expires_at).getTime() < Date.now(),
      employee: {
        id: row.employee_id,
        employeeCode: row.employee_code,
        fullName: row.full_name,
        email: row.email,
        status: row.employee_status,
        department: row.department_name,
      },
      attemptId: row.attempt_id,
      attemptStatus: row.attempt_status,
      percentage: row.percentage === null ? null : Number(row.percentage),
      passed: row.passed,
      completedAt: row.completed_at,
      targetType: row.target_type,
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}
