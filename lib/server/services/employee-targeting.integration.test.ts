/**
 * Employees / Departments / Projects / assessment targeting against a real
 * Postgres (throwaway databases; see test/support/employee-test-database.ts).
 * Skips without TEST_DATABASE_URL.
 *
 * The guarantees under test are database guarantees — composite tenant FKs,
 * the partial unique invite index, ON CONFLICT under concurrency — so they are
 * exercised for real, through the same services the API routes call.
 *
 * Email: the Resend client is replaced through its global cache with a fake
 * that records batches, so no real email can be sent.
 */

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, test } from "node:test"

import {
  EMPLOYEE_BASELINE_SQL,
  EMPLOYEE_TARGETING_MIGRATION,
  EMPLOYEE_TARGETING_ROLLBACK,
  createEmployeeTestDatabase,
} from "../../../test/support/employee-test-database.ts"

const db = await createEmployeeTestDatabase()
const suite = db ? describe : describe.skip

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const MANAGER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const USER_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const authA = { organizationId: ORG_A, userId: MANAGER_A }

type FakeBatch = { to: string; subject: string; html: string }[]
const sentBatches: FakeBatch[] = []
let failEmails = false

let employees: typeof import("@/lib/server/services/employee")
let units: typeof import("@/lib/server/services/org-units")
let targeting: typeof import("@/lib/server/services/employee-targeting")
let prismaModule: typeof import("@/lib/server/prisma")
let validators: typeof import("@/lib/server/employees/validators")

const ids: Record<string, string> = {}

function target(input: Record<string, unknown>) {
  return validators.assessmentTargetSchema.parse(input)
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (error: { statusCode?: number; code?: string }) => {
    assert.equal(error.statusCode, status, `expected HTTP ${status}, got ${error.statusCode} (${error.code})`)
    assert.equal(error.code, code)
    return true
  })
}

async function publishedAssessment(org: string, title: string, participantType = "EMPLOYEE", status = "PUBLISHED") {
  const { rows } = await db!.pool.query<{ id: string }>(
    `insert into public.assessments (organization_id, title, status, participant_type, job_id)
     values ($1, $2, $3, $4, $5) returning id::text`,
    [org, title, status, participantType, participantType === "CANDIDATE" ? randomUUID() : null]
  )
  const assessmentId = rows[0].id
  const version = await db!.pool.query<{ id: string }>(
    `insert into public.assessment_versions (assessment_id, version_number, status) values ($1, 1, 'FINALIZED') returning id::text`,
    [assessmentId]
  )
  if (status === "PUBLISHED") {
    await db!.pool.query(`update public.assessments set active_version_id = $2 where id = $1`, [assessmentId, version.rows[0].id])
  }
  return assessmentId
}

async function liveInvites(assessmentId: string) {
  const { rows } = await db!.pool.query<{ employee_id: string; status: string; sent_at: Date | null; target_id: string | null }>(
    `select employee_id::text, status, sent_at, target_id::text from public.assessment_invites
     where assessment_id = $1 and status <> 'CANCELLED' order by employee_id`,
    [assessmentId]
  )
  return rows
}

/** Marks an employee's invite completed with a scored result, as the assessment app does. */
async function completeInvite(assessmentId: string, employeeId: string, percentage: number, passed: boolean) {
  const { rows } = await db!.pool.query<{ id: string; version_id: string }>(
    `update public.assessment_invites set status = 'COMPLETED', completed_at = now()
     where assessment_id = $1 and employee_id = $2 and status <> 'CANCELLED' returning id::text, version_id::text`,
    [assessmentId, employeeId]
  )
  const invite = rows[0]
  const attempt = await db!.pool.query<{ id: string }>(
    `insert into public.assessment_attempts (invite_id, assessment_id, version_id, employee_id, organization_id, status, percentage, passed)
     values ($1, $2, $3, $4, $5, 'SUBMITTED', $6, $7) returning id::text`,
    [invite.id, assessmentId, invite.version_id, employeeId, ORG_A, percentage, passed]
  )
  await db!.pool.query(
    `insert into public.assessment_results (attempt_id, assessment_id, employee_id, organization_id, percentage, passed, completed_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [attempt.rows[0].id, assessmentId, employeeId, ORG_A, percentage, passed]
  )
}

before(async () => {
  if (!db) return

  for (const key of ["DB_POOL_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]) {
    delete process.env[key]
  }
  process.env.DATABASE_URL = db.url
  process.env.RESEND_API_KEY = "test-only-key"
  process.env.EMAIL_FROM = "VerisNova Test <test@example.test>"
  process.env.ASSESSMENT_APP_BASE_URL = "https://assessment.example.test"
  ;(globalThis as unknown as { verisnovaResend: unknown }).verisnovaResend = {
    emails: {
      send: async () => {
        throw new Error("single sends are not expected in these tests")
      },
    },
    batch: {
      send: async (payloads: FakeBatch) => {
        if (failEmails) return { data: null, error: { message: "Invalid `from` field" } }
        sentBatches.push(payloads)
        return { data: { data: payloads.map(() => ({ id: randomUUID() })) }, error: null }
      },
    },
  }

  employees = await import("@/lib/server/services/employee")
  units = await import("@/lib/server/services/org-units")
  targeting = await import("@/lib/server/services/employee-targeting")
  prismaModule = await import("@/lib/server/prisma")
  validators = await import("@/lib/server/employees/validators")

  await db.pool.query(
    `insert into public.organizations (organization_id, organization_name) values ($1, 'Org A'), ($2, 'Org B')`,
    [ORG_A, ORG_B]
  )
  await db.pool.query(
    `insert into public.users (user_id, organization_id, full_name, email, role)
     values ($3, $1, 'Maya Manager', 'maya@a.test', 'RECRUITER'), ($4, $2, 'Bob B', 'bob@b.test', 'RECRUITER')`,
    [ORG_A, ORG_B, MANAGER_A, USER_B]
  )
})

after(async () => {
  if (!db) return
  await prismaModule?.prisma.$disconnect()
  await db.drop()
})

suite("departments", () => {
  test("create, unique per organization (case-insensitive), same name allowed in another org", async () => {
    const engineering = await units.createDepartment(ORG_A, { name: "Engineering", description: "Builders", status: "ACTIVE" })
    ids.engineering = engineering.id
    assert.equal(engineering.employeeCount, 0)

    ids.hr = (await units.createDepartment(ORG_A, { name: "HR", status: "ACTIVE" })).id
    ids.finance = (await units.createDepartment(ORG_A, { name: "Finance", status: "ACTIVE" })).id

    await expectApiError(units.createDepartment(ORG_A, { name: "engineering", status: "ACTIVE" }), 409, "DEPARTMENT_NAME_TAKEN")

    ids.engineeringB = (await units.createDepartment(ORG_B, { name: "Engineering", status: "ACTIVE" })).id
    assert.notEqual(ids.engineeringB, ids.engineering)
  })

  test("list and get are scoped to the organization", async () => {
    const listA = await units.listDepartments(ORG_A, {})
    assert.deepEqual(listA.departments.map((d) => d.name), ["Engineering", "Finance", "HR"])
    const listB = await units.listDepartments(ORG_B, {})
    assert.deepEqual(listB.departments.map((d) => d.name), ["Engineering"])

    await expectApiError(units.getDepartment(ORG_A, ids.engineeringB), 404, "DEPARTMENT_NOT_FOUND")
    await expectApiError(units.updateDepartment(ORG_A, ids.engineeringB, { name: "Hijacked" }), 404, "DEPARTMENT_NOT_FOUND")
  })

  test("edit: rename cannot collide", async () => {
    await expectApiError(units.updateDepartment(ORG_A, ids.finance, { name: "HR" }), 409, "DEPARTMENT_NAME_TAKEN")
    const updated = await units.updateDepartment(ORG_A, ids.finance, { description: "Money" })
    assert.equal(updated.description, "Money")
  })
})

suite("projects", () => {
  test("create with unique name and code per organization", async () => {
    ids.alpha = (await units.createProject(ORG_A, { name: "Project Alpha", code: "ALPHA", status: "ACTIVE" })).id
    ids.beta = (await units.createProject(ORG_A, { name: "Project Beta", code: "BETA", status: "ACTIVE" })).id
    ids.gamma = (await units.createProject(ORG_A, { name: "Project Gamma", status: "ACTIVE" })).id

    await expectApiError(units.createProject(ORG_A, { name: "project alpha", status: "ACTIVE" }), 409, "PROJECT_NAME_TAKEN")
    await expectApiError(units.createProject(ORG_A, { name: "Other", code: "alpha", status: "ACTIVE" }), 409, "PROJECT_CODE_TAKEN")

    ids.alphaB = (await units.createProject(ORG_B, { name: "Project Alpha", code: "ALPHA", status: "ACTIVE" })).id

    const search = await units.listProjects(ORG_A, { search: "beta" })
    assert.deepEqual(search.projects.map((p) => p.name), ["Project Beta"])
  })

  test("edit", async () => {
    const updated = await units.updateProject(ORG_A, ids.gamma, { code: "GAM", description: "Third" })
    assert.equal(updated.code, "GAM")
    await expectApiError(units.updateProject(ORG_A, ids.gamma, { code: "BETA" }), 409, "PROJECT_CODE_TAKEN")
  })
})

suite("employees", () => {
  test("create with department, multiple projects and manager; full_name and legacy department kept in sync", async () => {
    const rahul = await employees.createEmployee(ORG_A, {
      employeeCode: "E-001",
      firstName: "Rahul",
      lastName: "Sharma",
      email: "Rahul@A.test",
      departmentId: ids.engineering,
      projectIds: [ids.alpha, ids.beta],
      managerUserId: MANAGER_A,
      title: "Engineer",
      joiningDate: "2024-01-15",
      status: "ACTIVE",
    })
    ids.rahul = rahul.id
    assert.equal(rahul.fullName, "Rahul Sharma")
    assert.equal(rahul.email, "rahul@a.test")
    assert.equal(rahul.department, "Engineering")
    assert.equal(rahul.departmentInfo?.name, "Engineering")
    assert.deepEqual(rahul.projects.map((p) => p.name), ["Project Alpha", "Project Beta"])
    assert.equal(rahul.manager?.fullName, "Maya Manager")
    assert.equal(rahul.joiningDate?.toISOString().slice(0, 10), "2024-01-15")

    const make = async (key: string, first: string, dept: string, projects: string[], status: "ACTIVE" | "INACTIVE" = "ACTIVE") => {
      const created = await employees.createEmployee(ORG_A, {
        firstName: first,
        lastName: "Test",
        email: `${first.toLowerCase()}@a.test`,
        departmentId: dept,
        projectIds: projects,
        status,
      })
      ids[key] = created.id
    }
    await make("priya", "Priya", ids.engineering, [ids.alpha])
    await make("amit", "Amit", ids.engineering, [ids.beta])
    await make("neha", "Neha", ids.hr, [ids.alpha])
    await make("vik", "Vik", ids.engineering, [ids.alpha], "INACTIVE")

    const other = await employees.createEmployee(ORG_B, {
      firstName: "Olga",
      email: "olga@b.test",
      departmentId: ids.engineeringB,
      projectIds: [ids.alphaB],
      status: "ACTIVE",
    })
    ids.olga = other.id
  })

  test("legacy payload (fullName + free-text department) still works", async () => {
    const legacy = await employees.createEmployee(ORG_A, {
      fullName: "Legacy Person Name",
      email: "legacy@a.test",
      department: "Somewhere",
      status: "ACTIVE",
    })
    ids.legacy = legacy.id
    assert.equal(legacy.firstName, "Legacy")
    assert.equal(legacy.lastName, "Person Name")
    assert.equal(legacy.department, "Somewhere")
    assert.equal(legacy.departmentId, null)
  })

  test("duplicates and cross-tenant references are rejected", async () => {
    await expectApiError(
      employees.createEmployee(ORG_A, { firstName: "Dup", email: "RAHUL@a.test", status: "ACTIVE" }),
      409,
      "EMPLOYEE_ALREADY_EXISTS"
    )
    await expectApiError(
      employees.createEmployee(ORG_A, { firstName: "Dup", email: "dup@a.test", employeeCode: "E-001", status: "ACTIVE" }),
      409,
      "EMPLOYEE_CODE_TAKEN"
    )
    // Org B's department / project / manager cannot be used from org A.
    await expectApiError(
      employees.createEmployee(ORG_A, { firstName: "X", email: "x1@a.test", departmentId: ids.engineeringB, status: "ACTIVE" }),
      404,
      "DEPARTMENT_NOT_FOUND"
    )
    await expectApiError(
      employees.createEmployee(ORG_A, { firstName: "X", email: "x2@a.test", projectIds: [ids.alphaB], status: "ACTIVE" }),
      404,
      "PROJECT_NOT_FOUND"
    )
    await expectApiError(
      employees.createEmployee(ORG_A, { firstName: "X", email: "x3@a.test", managerUserId: USER_B, status: "ACTIVE" }),
      404,
      "MANAGER_NOT_FOUND"
    )
    await expectApiError(employees.getEmployee(ORG_A, ids.olga), 404, "EMPLOYEE_NOT_FOUND")
    await expectApiError(employees.updateEmployee(ORG_A, ids.olga, { title: "pwned" }), 404, "EMPLOYEE_NOT_FOUND")
  })

  test("the database itself refuses cross-organization links (composite FKs)", async () => {
    await assert.rejects(
      db!.pool.query(`insert into public.employee_projects (organization_id, employee_id, project_id) values ($1, $2, $3)`, [
        ORG_A,
        ids.rahul,
        ids.alphaB,
      ]),
      /employee_projects_project_fk/
    )
    await assert.rejects(
      db!.pool.query(`update public.employees set department_id = $2 where id = $1`, [ids.rahul, ids.engineeringB]),
      /employees_department_fk/
    )
  })

  test("search, filter by department / project / status, pagination", async () => {
    const byDept = await employees.listEmployees(ORG_A, { departmentId: ids.engineering, page: 1, pageSize: 20 })
    assert.deepEqual(byDept.employees.map((e) => e.firstName), ["Amit", "Priya", "Rahul", "Vik"])

    const byProject = await employees.listEmployees(ORG_A, { projectId: ids.alpha, status: "ACTIVE", page: 1, pageSize: 20 })
    assert.deepEqual(byProject.employees.map((e) => e.firstName), ["Neha", "Priya", "Rahul"])

    const search = await employees.listEmployees(ORG_A, { search: "e-001", page: 1, pageSize: 20 })
    assert.deepEqual(search.employees.map((e) => e.firstName), ["Rahul"])

    const page2 = await employees.listEmployees(ORG_A, { page: 2, pageSize: 2 })
    assert.equal(page2.meta.total, 6)
    assert.equal(page2.meta.totalPages, 3)
    assert.equal(page2.employees.length, 2)

    // Org B's employee never appears for org A, even filtering by its project.
    const leak = await employees.listEmployees(ORG_A, { projectId: ids.alphaB, page: 1, pageSize: 20 })
    assert.equal(leak.meta.total, 0)
  })

  test("edit: names, department move, project replacement, deactivate", async () => {
    const edited = await employees.updateEmployee(ORG_A, ids.legacy, {
      firstName: "Lee",
      lastName: "Gacy",
      departmentId: ids.finance,
      projectIds: [ids.gamma],
    })
    assert.equal(edited.fullName, "Lee Gacy")
    assert.equal(edited.department, "Finance")
    assert.deepEqual(edited.projects.map((p) => p.name), ["Project Gamma"])

    const removed = await employees.updateEmployee(ORG_A, ids.legacy, { projectIds: [] })
    assert.deepEqual(removed.projects, [])

    const inactive = await employees.updateEmployee(ORG_A, ids.legacy, { status: "INACTIVE" })
    assert.equal(inactive.status, "INACTIVE")
  })

  test("department and project counts; renaming a department syncs employees.department", async () => {
    const engineering = await units.getDepartment(ORG_A, ids.engineering)
    assert.equal(engineering.employeeCount, 4)
    assert.equal(engineering.activeEmployeeCount, 3)

    const alpha = await units.getProject(ORG_A, ids.alpha)
    assert.equal(alpha.activeEmployeeCount, 3)

    await units.updateDepartment(ORG_A, ids.finance, { name: "Finance & Accounts" })
    const legacy = await employees.getEmployee(ORG_A, ids.legacy)
    assert.equal(legacy.department, "Finance & Accounts")
  })

  test("project membership: add is idempotent, cross-org rejected, remove", async () => {
    const added = await units.addProjectMembers(ORG_A, ids.gamma, [ids.amit, ids.neha])
    assert.deepEqual(added, { added: 2, alreadyMembers: 0 })
    const again = await units.addProjectMembers(ORG_A, ids.gamma, [ids.amit])
    assert.deepEqual(again, { added: 0, alreadyMembers: 1 })

    await expectApiError(units.addProjectMembers(ORG_A, ids.gamma, [ids.olga]), 404, "EMPLOYEE_NOT_FOUND")
    await expectApiError(units.addProjectMembers(ORG_A, ids.alphaB, [ids.amit]), 404, "PROJECT_NOT_FOUND")

    await units.removeProjectMember(ORG_A, ids.gamma, ids.neha)
    const gamma = await units.getProject(ORG_A, ids.gamma)
    assert.equal(gamma.employeeCount, 1)
    await expectApiError(units.removeProjectMember(ORG_A, ids.gamma, ids.neha), 404, "PROJECT_MEMBER_NOT_FOUND")
  })
})

suite("assessment targeting", () => {
  test("setup assessments", async () => {
    ids.sql = await publishedAssessment(ORG_A, "Annual SQL Assessment")
    ids.draft = await publishedAssessment(ORG_A, "Draft Assessment", "EMPLOYEE", "DRAFT")
    ids.candidateAssessment = await publishedAssessment(ORG_A, "Candidate Test", "CANDIDATE")
    ids.sqlB = await publishedAssessment(ORG_B, "Org B Assessment")
  })

  test("preview: department, project, department + project, individual — computed in the database", async () => {
    const dept = await targeting.previewAssessmentTarget(ORG_A, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.engineering }), 1, 25)
    // Rahul, Priya, Amit (Vik is inactive).
    assert.deepEqual(dept.counts, { matched: 3, alreadyAssigned: 0, alreadyCompleted: 0, newAssignments: 3 })
    assert.deepEqual(dept.employees.map((e) => e.fullName), ["Amit Test", "Priya Test", "Rahul Sharma"])
    assert.equal(dept.target.label, "Engineering")
    assert.equal(dept.canSend, true)

    const project = await targeting.previewAssessmentTarget(ORG_A, ids.sql, target({ targetType: "PROJECT", projectId: ids.alpha }), 1, 25)
    // Rahul, Priya, Neha.
    assert.equal(project.counts.matched, 3)

    const both = await targeting.previewAssessmentTarget(
      ORG_A,
      ids.sql,
      target({ targetType: "DEPARTMENT_PROJECT", departmentId: ids.engineering, projectId: ids.alpha }),
      1,
      25
    )
    // Engineering AND Alpha: Rahul (on Alpha + Beta) and Priya — counted once each.
    assert.deepEqual(both.employees.map((e) => e.fullName), ["Priya Test", "Rahul Sharma"])
    assert.equal(both.target.label, "Engineering / Project Alpha")

    const individual = await targeting.previewAssessmentTarget(
      ORG_A,
      ids.sql,
      target({ targetType: "INDIVIDUAL", employeeIds: [ids.rahul, ids.vik, ids.olga, randomUUID()] }),
      1,
      25
    )
    assert.equal(individual.counts.matched, 1)
    assert.deepEqual(individual.selection, { requested: 4, inactive: 1, notFound: 2 })

    const paged = await targeting.previewAssessmentTarget(ORG_A, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.engineering }), 2, 2)
    assert.equal(paged.meta.total, 3)
    assert.deepEqual(paged.employees.map((e) => e.fullName), ["Rahul Sharma"])
  })

  test("assign department + project, then department: only the difference is assigned", async () => {
    const first = await targeting.assignAssessmentToTarget(
      authA,
      ids.sql,
      target({ targetType: "DEPARTMENT_PROJECT", departmentId: ids.engineering, projectId: ids.alpha })
    )
    assert.equal(first.matched, 2)
    assert.equal(first.assigned, 2)
    assert.equal(first.alreadyAssigned, 0)
    assert.equal(first.emailsSent, 2)
    assert.equal(sentBatches.length, 1)
    assert.deepEqual(sentBatches[0].map((m) => m.to).sort(), ["priya@a.test", "rahul@a.test"])
    assert.match(sentBatches[0][0].html, /https:\/\/assessment\.example\.test\/a\/[0-9a-f]{64}/)
    assert.match(sentBatches[0][0].subject, /Annual SQL Assessment/)

    const invites = await liveInvites(ids.sql)
    assert.equal(invites.length, 2)
    assert.ok(invites.every((i) => i.sent_at !== null && i.target_id === first.targetId))

    const preview = await targeting.previewAssessmentTarget(ORG_A, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.engineering }), 1, 25)
    assert.deepEqual(preview.counts, { matched: 3, alreadyAssigned: 2, alreadyCompleted: 0, newAssignments: 1 })
    assert.equal(preview.employees.find((e) => e.fullName === "Rahul Sharma")?.alreadyAssigned, true)

    const second = await targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.engineering }))
    assert.deepEqual([second.matched, second.alreadyAssigned, second.assigned], [3, 2, 1])
    assert.deepEqual(sentBatches[1].map((m) => m.to), ["amit@a.test"])
    assert.equal((await liveInvites(ids.sql)).length, 3)

    const { rows } = await db!.pool.query(
      `select target_type, matched_count, already_assigned_count, assigned_count from public.assessment_targets
       where assessment_id = $1 order by created_at`,
      [ids.sql]
    )
    assert.deepEqual(rows, [
      { target_type: "DEPARTMENT_PROJECT", matched_count: 2, already_assigned_count: 0, assigned_count: 2 },
      { target_type: "DEPARTMENT", matched_count: 3, already_assigned_count: 2, assigned_count: 1 },
    ])
  })

  test("repeating a send assigns nobody and records nothing", async () => {
    const batchesBefore = sentBatches.length
    const repeat = await targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.engineering }))
    assert.deepEqual([repeat.matched, repeat.alreadyAssigned, repeat.assigned, repeat.targetId], [3, 3, 0, null])
    assert.equal(sentBatches.length, batchesBefore)
    const { rows } = await db!.pool.query<{ n: number }>(`select count(*)::int as n from public.assessment_targets where assessment_id = $1`, [ids.sql])
    assert.equal(rows[0].n, 2)
  })

  test("concurrent sends for the same people create exactly one invite each", async () => {
    // Neha (HR, Alpha) is the only new Alpha member; fire three sends at once.
    const results = await Promise.allSettled([
      targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "PROJECT", projectId: ids.alpha })),
      targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "PROJECT", projectId: ids.alpha })),
      targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "INDIVIDUAL", employeeIds: [ids.neha] })),
    ])
    for (const result of results) assert.equal(result.status, "fulfilled")
    const assigned = results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value.assigned : 0), 0)
    assert.equal(assigned, 1)

    const neha = (await liveInvites(ids.sql)).filter((i) => i.employee_id === ids.neha)
    assert.equal(neha.length, 1)
  })

  test("the partial unique index blocks a second live invite but allows re-issue after cancel", async () => {
    const insertInvite = (status: string) =>
      db!.pool.query(
        `insert into public.assessment_invites (assessment_id, version_id, employee_id, organization_id, token_hash, status, expires_at)
         select a.id, a.active_version_id, $2, a.organization_id, md5(random()::text), $3, now() + interval '7 days'
         from public.assessments a where a.id = $1`,
        [ids.sql, ids.rahul, status]
      )
    await assert.rejects(insertInvite("INVITED"), /uq_assessment_invites_assessment_employee/)
    await insertInvite("CANCELLED")
    assert.equal((await liveInvites(ids.sql)).filter((i) => i.employee_id === ids.rahul).length, 1)
  })

  test("completed employees are counted as already assigned and never re-sent", async () => {
    await completeInvite(ids.sql, ids.rahul, 82, true)
    await completeInvite(ids.sql, ids.priya, 45, false)

    const preview = await targeting.previewAssessmentTarget(ORG_A, ids.sql, target({ targetType: "PROJECT", projectId: ids.alpha }), 1, 25)
    assert.deepEqual(preview.counts, { matched: 3, alreadyAssigned: 3, alreadyCompleted: 2, newAssignments: 0 })
    assert.equal(preview.canSend, false)
    assert.equal(preview.sendBlockedReason, "Every matching employee already has this assessment.")
  })

  test("dashboard stats: assigned / completed / pending / average / pass rate, and manager scoping", async () => {
    const stats = await targeting.getEmployeeAssessmentStats(ORG_A, [ids.sql], null)
    assert.deepEqual(stats.get(ids.sql), { assigned: 4, completed: 2, pending: 2, averageScore: 63.5, passRate: 50 })

    // Only Rahul reports to MANAGER_A.
    const scoped = await targeting.getEmployeeAssessmentStats(ORG_A, [ids.sql], MANAGER_A)
    assert.deepEqual(scoped.get(ids.sql), { assigned: 1, completed: 1, pending: 0, averageScore: 82, passRate: 100 })

    // 2 sequential sends + however many of the 3 concurrent ones got past
    // the "anyone new?" check before another committed.
    const latest = await targeting.getLatestTargets(ORG_A, [ids.sql])
    assert.ok((latest.get(ids.sql)?.sends ?? 0) >= 3)

    const list = await targeting.listAssessmentAssignments(ORG_A, ids.sql, { page: 1, pageSize: 25, status: "COMPLETED" }, null)
    assert.deepEqual(list.assignments.map((a) => [a.employee.fullName, a.percentage, a.passed]).sort(), [
      ["Priya Test", 45, false],
      ["Rahul Sharma", 82, true],
    ])
    const pending = await targeting.listAssessmentAssignments(ORG_A, ids.sql, { page: 1, pageSize: 25, status: "PENDING" }, null)
    assert.equal(pending.meta.total, 2)
  })

  test("history survives deactivation, department moves and project removal", async () => {
    await employees.updateEmployee(ORG_A, ids.amit, { status: "INACTIVE" })
    await employees.updateEmployee(ORG_A, ids.priya, { departmentId: ids.hr })
    await units.removeProjectMember(ORG_A, ids.alpha, ids.rahul)

    const invites = await liveInvites(ids.sql)
    assert.equal(invites.length, 4)
    const stats = await targeting.getEmployeeAssessmentStats(ORG_A, [ids.sql], null)
    assert.equal(stats.get(ids.sql)?.completed, 2)

    // Targeting reflects the new structure: Amit is inactive, Priya moved.
    const dept = await targeting.previewAssessmentTarget(ORG_A, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.engineering }), 1, 25)
    assert.deepEqual(dept.employees.map((e) => e.fullName), ["Rahul Sharma"])
    const hr = await targeting.previewAssessmentTarget(ORG_A, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.hr }), 1, 25)
    assert.deepEqual(hr.employees.map((e) => [e.fullName, e.alreadyAssigned]), [
      ["Neha Test", true],
      ["Priya Test", true],
    ])
  })

  test("empty department, empty project and zero-match combinations", async () => {
    ids.ops = (await units.createDepartment(ORG_A, { name: "Operations", status: "ACTIVE" })).id
    ids.empty = (await units.createProject(ORG_A, { name: "Project Empty", status: "ACTIVE" })).id

    for (const t of [
      { targetType: "DEPARTMENT", departmentId: ids.ops },
      { targetType: "PROJECT", projectId: ids.empty },
      { targetType: "DEPARTMENT_PROJECT", departmentId: ids.hr, projectId: ids.beta },
    ]) {
      const preview = await targeting.previewAssessmentTarget(ORG_A, ids.sql, target(t), 1, 25)
      assert.equal(preview.counts.matched, 0)
      assert.equal(preview.canSend, false)
      assert.equal(preview.sendBlockedReason, "No active employees match this target.")
      await expectApiError(targeting.assignAssessmentToTarget(authA, ids.sql, target(t)), 409, "NO_MATCHING_EMPLOYEES")
    }
  })

  test("inactive departments and projects cannot be targeted or joined, history kept", async () => {
    await units.updateDepartment(ORG_A, ids.engineering, { status: "INACTIVE" })
    await units.updateProject(ORG_A, ids.beta, { status: "INACTIVE" })

    await expectApiError(
      targeting.previewAssessmentTarget(ORG_A, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.engineering }), 1, 25),
      409,
      "DEPARTMENT_INACTIVE"
    )
    await expectApiError(
      targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "PROJECT", projectId: ids.beta })),
      409,
      "PROJECT_INACTIVE"
    )
    await expectApiError(
      employees.updateEmployee(ORG_A, ids.neha, { departmentId: ids.engineering }),
      409,
      "DEPARTMENT_INACTIVE"
    )
    await expectApiError(units.addProjectMembers(ORG_A, ids.beta, [ids.neha]), 409, "PROJECT_INACTIVE")

    // Rahul stays in the (now inactive) department and can still be edited.
    const rahul = await employees.updateEmployee(ORG_A, ids.rahul, { title: "Senior Engineer", departmentId: ids.engineering })
    assert.equal(rahul.department, "Engineering")
    assert.equal((await liveInvites(ids.sql)).length, 4)

    await units.updateDepartment(ORG_A, ids.engineering, { status: "ACTIVE" })
    await units.updateProject(ORG_A, ids.beta, { status: "ACTIVE" })
  })

  test("only published employee assessments can be assigned", async () => {
    await expectApiError(
      targeting.assignAssessmentToTarget(authA, ids.draft, target({ targetType: "DEPARTMENT", departmentId: ids.hr })),
      409,
      "ASSESSMENT_NOT_PUBLISHED"
    )
    const draftPreview = await targeting.previewAssessmentTarget(ORG_A, ids.draft, target({ targetType: "DEPARTMENT", departmentId: ids.hr }), 1, 25)
    assert.equal(draftPreview.canSend, false)
    assert.equal(draftPreview.sendBlockedReason, "Publish this assessment before assigning it.")

    await expectApiError(
      targeting.assignAssessmentToTarget(authA, ids.candidateAssessment, target({ targetType: "DEPARTMENT", departmentId: ids.hr })),
      409,
      "NOT_AN_EMPLOYEE_ASSESSMENT"
    )
  })

  test("tenant isolation: org A cannot preview, assign or read org B", async () => {
    // Org B's assessment from org A.
    await expectApiError(
      targeting.previewAssessmentTarget(ORG_A, ids.sqlB, target({ targetType: "DEPARTMENT", departmentId: ids.hr }), 1, 25),
      404,
      "ASSESSMENT_NOT_FOUND"
    )
    await expectApiError(
      targeting.assignAssessmentToTarget(authA, ids.sqlB, target({ targetType: "DEPARTMENT", departmentId: ids.hr })),
      404,
      "ASSESSMENT_NOT_FOUND"
    )
    await expectApiError(targeting.listAssessmentAssignments(ORG_A, ids.sqlB, { page: 1, pageSize: 25 }, null), 404, "ASSESSMENT_NOT_FOUND")

    // Org B's department / project on org A's assessment.
    await expectApiError(
      targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "DEPARTMENT", departmentId: ids.engineeringB })),
      404,
      "DEPARTMENT_NOT_FOUND"
    )
    await expectApiError(
      targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "PROJECT", projectId: ids.alphaB })),
      404,
      "PROJECT_NOT_FOUND"
    )

    // Org B's employee id in an individual selection is simply not matched.
    const result = await targeting.assignAssessmentToTarget(authA, ids.sql, target({ targetType: "INDIVIDUAL", employeeIds: [ids.olga, ids.neha] }))
    assert.deepEqual([result.matched, result.assigned], [1, 0])
    const { rows } = await db!.pool.query<{ n: number }>(`select count(*)::int as n from public.assessment_invites where employee_id = $1`, [ids.olga])
    assert.equal(rows[0].n, 0)

    // Stats for org B's assessment are empty from org A.
    const stats = await targeting.getEmployeeAssessmentStats(ORG_A, [ids.sqlB], null)
    assert.equal(stats.size, 0)
  })

  test("email failure keeps the assignment and leaves sent_at empty", async () => {
    const onboarding = await publishedAssessment(ORG_A, "Onboarding Check")
    failEmails = true
    try {
      const result = await targeting.assignAssessmentToTarget(authA, onboarding, target({ targetType: "DEPARTMENT", departmentId: ids.hr }))
      assert.deepEqual([result.assigned, result.emailsSent, result.emailsFailed], [2, 0, 2])
      assert.match(result.emailError ?? "", /Invalid `from` field/)
      const invites = await liveInvites(onboarding)
      assert.equal(invites.length, 2)
      assert.ok(invites.every((i) => i.sent_at === null))
    } finally {
      failEmails = false
    }
  })
})

suite("migration", () => {
  test("backfills departments and first/last names from existing employees", async () => {
    const fresh = await createEmployeeTestDatabase(EMPLOYEE_BASELINE_SQL)
    assert.ok(fresh)
    try {
      await fresh.pool.query(
        `insert into public.employees (organization_id, full_name, email, department) values
           ($1, 'Asha Rao', 'asha@a.test', 'Engineering'),
           ($1, 'Ben', 'ben@a.test', ' engineering '),
           ($1, 'Cara De La Cruz', 'cara@a.test', 'Sales'),
           ($1, 'Dev None', 'dev@a.test', null),
           ($2, 'Eve B', 'eve@b.test', 'Engineering')`,
        [ORG_A, ORG_B]
      )
      await fresh.runSqlFile(EMPLOYEE_TARGETING_MIGRATION)

      const { rows: departments } = await fresh.pool.query(
        `select organization_id::text, name from public.departments order by organization_id, name`
      )
      assert.deepEqual(departments, [
        { organization_id: ORG_A, name: "Engineering" },
        { organization_id: ORG_A, name: "Sales" },
        { organization_id: ORG_B, name: "Engineering" },
      ])

      const { rows: people } = await fresh.pool.query(
        `select e.email, e.first_name, e.last_name, d.name as department
         from public.employees e left join public.departments d on d.id = e.department_id order by e.email`
      )
      assert.deepEqual(people, [
        { email: "asha@a.test", first_name: "Asha", last_name: "Rao", department: "Engineering" },
        { email: "ben@a.test", first_name: "Ben", last_name: null, department: "Engineering" },
        { email: "cara@a.test", first_name: "Cara", last_name: "De La Cruz", department: "Sales" },
        { email: "dev@a.test", first_name: "Dev", last_name: "None", department: null },
        { email: "eve@b.test", first_name: "Eve", last_name: "B", department: "Engineering" },
      ])

      // Rollback removes everything it added and leaves the old columns intact.
      await fresh.runSqlFile(EMPLOYEE_TARGETING_ROLLBACK)
      const { rows: tables } = await fresh.pool.query<{ n: number }>(
        `select table_name from information_schema.tables where table_schema = 'public'
         and table_name in ('departments', 'projects', 'employee_projects', 'assessment_targets')`
      )
      assert.equal(tables.length, 0)
      const { rows: legacy } = await fresh.pool.query(`select full_name, department from public.employees where email = 'asha@a.test'`)
      assert.deepEqual(legacy, [{ full_name: "Asha Rao", department: "Engineering" }])
    } finally {
      await fresh.drop()
    }
  })

  test("refuses (and changes nothing) when duplicate live employee invites already exist", async () => {
    const fresh = await createEmployeeTestDatabase(EMPLOYEE_BASELINE_SQL)
    assert.ok(fresh)
    try {
      const { rows } = await fresh.pool.query<{ id: string }>(
        `insert into public.employees (organization_id, full_name, email) values ($1, 'Dup Person', 'dup@a.test') returning id::text`,
        [ORG_A]
      )
      const assessment = await fresh.pool.query<{ id: string }>(
        `insert into public.assessments (organization_id, title, participant_type) values ($1, 'Dup', 'EMPLOYEE') returning id::text`,
        [ORG_A]
      )
      const version = await fresh.pool.query<{ id: string }>(
        `insert into public.assessment_versions (assessment_id, version_number) values ($1, 1) returning id::text`,
        [assessment.rows[0].id]
      )
      for (const hash of ["h1", "h2"]) {
        await fresh.pool.query(
          `insert into public.assessment_invites (assessment_id, version_id, employee_id, organization_id, token_hash, expires_at)
           values ($1, $2, $3, $4, $5, now())`,
          [assessment.rows[0].id, version.rows[0].id, rows[0].id, ORG_A, hash]
        )
      }

      await assert.rejects(fresh.runSqlFile(EMPLOYEE_TARGETING_MIGRATION), /more than one non-cancelled invite/)
      const { rows: tables } = await fresh.pool.query<{ n: number }>(
        `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'departments'`
      )
      assert.equal(tables[0].n, 0)
    } finally {
      await fresh.drop()
    }
  })
})
