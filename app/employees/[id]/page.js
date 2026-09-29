"use client"

import Link from "next/link"
import { use as usePromise, useEffect, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import AddEmployeeModal from "@/components/AddEmployeeModal"
import Navbar from "@/components/Navbar"
import {
  AssignmentPill,
  FIELD_CLASS,
  PRIMARY_BUTTON,
  ROW_ACTION,
  ResultPill,
  SECONDARY_BUTTON,
  SECTION_CLASS,
  StatusPill,
  TABLE_HEAD_ROW,
  apiRequest,
  formatPercent,
} from "@/components/employees/shared"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDate } from "@/lib/client/date-format"
import { formatLabel } from "@/lib/client/format-label"
import { showActionFeedback } from "@/lib/client/action-feedback"

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-sm text-slate-200">{children || <span className="text-slate-500">-</span>}</dd>
    </div>
  )
}

export default function EmployeeDetailPage({ params }) {
  const { id } = usePromise(params)
  const searchParams = useAuthSearchParams()

  const [employee, setEmployee] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [availableActivities, setAvailableActivities] = useState([])
  const [selectedAssessmentId, setSelectedAssessmentId] = useState("")
  const [assigning, setAssigning] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const load = () => {
    setLoading(true)
    apiRequest(`/api/employees/${id}/activities`, searchParams)
      .then((res) => {
        setEmployee(res.data?.employee ?? null)
        setActivities(res.data?.activities ?? [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    apiRequest("/api/assessments?participantType=EMPLOYEE&status=PUBLISHED&pageSize=100", searchParams).then((res) =>
      setAvailableActivities(res.data?.assessments ?? [])
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const assignedIds = new Set(activities.filter((a) => a.inviteStatus !== "CANCELLED").map((a) => a.assessmentId))
  const assignable = availableActivities.filter((a) => !assignedIds.has(a.id))

  const handleAssign = async () => {
    if (!selectedAssessmentId) {
      showActionFeedback({ tone: "error", title: "Pick an assessment", message: "Select a published employee assessment to assign." })
      return
    }
    setAssigning(true)
    const res = await apiRequest(`/api/assessments/${selectedAssessmentId}/invite`, searchParams, {
      method: "POST",
      body: { employeeId: id },
    })
    setAssigning(false)
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Assign failed", message: res.error?.message || "Failed to assign assessment" })
      return
    }
    showActionFeedback({
      tone: res.data?.emailSent ? "success" : "error",
      title: "Assessment assigned",
      message: res.data?.emailSent
        ? "The employee has been notified by email."
        : "Assigned, but the invitation email could not be sent.",
    })
    setSelectedAssessmentId("")
    load()
  }

  const toggleStatus = async () => {
    const nextStatus = employee.status === "INACTIVE" ? "ACTIVE" : "INACTIVE"
    const res = await apiRequest(`/api/employees/${id}`, searchParams, { method: "PATCH", body: { status: nextStatus } })
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Update failed", message: res.error?.message || "Something went wrong" })
      return
    }
    load()
  }

  const isInactive = employee?.status === "INACTIVE"

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1300px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <header className="min-w-0">
            <Link href={buildAuthUrl("/employees", searchParams)} className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300 hover:text-cyan-200">
              &larr; Employees
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
                {employee?.fullName ?? (loading ? "Loading..." : "Employee not found")}
              </h1>
              {employee ? <StatusPill status={employee.status} /> : null}
            </div>
            {employee ? (
              <p className="mt-1 text-sm text-slate-400">
                {[employee.title, employee.departmentInfo?.name ?? employee.department].filter(Boolean).join(" · ") || employee.email}
              </p>
            ) : null}
          </header>
          {employee ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setEditOpen(true)}>
                Edit
              </button>
              <button type="button" className={SECONDARY_BUTTON} onClick={toggleStatus}>
                {isInactive ? "Reactivate" : "Deactivate"}
              </button>
            </div>
          ) : null}
        </div>

        {employee ? (
          <section aria-label="Employee information" className={`${SECTION_CLASS} p-5`}>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Employee ID">{employee.employeeCode}</Detail>
              <Detail label="Email">{employee.email}</Detail>
              <Detail label="Phone">{employee.phone}</Detail>
              <Detail label="Designation">{employee.title}</Detail>
              <Detail label="Department">
                {employee.departmentInfo ? (
                  <Link
                    href={buildAuthUrl(`/employees/departments/${employee.departmentInfo.id}`, searchParams)}
                    className="text-cyan-300 hover:text-cyan-200"
                  >
                    {employee.departmentInfo.name}
                  </Link>
                ) : (
                  employee.department
                )}
              </Detail>
              <Detail label="Manager">{employee.manager ? employee.manager.fullName || employee.manager.email : null}</Detail>
              <Detail label="Joining date">{employee.joiningDate ? formatDate(employee.joiningDate) : null}</Detail>
              <Detail label="Added">{formatDate(employee.createdAt)}</Detail>
            </dl>
            <div className="mt-5 border-t border-slate-800 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Projects</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {employee.projects?.length ? (
                  employee.projects.map((project) => (
                    <Link
                      key={project.id}
                      href={buildAuthUrl(`/employees/projects/${project.id}`, searchParams)}
                      className="rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-xs text-slate-200 hover:border-cyan-400/40 hover:text-cyan-100"
                    >
                      {project.name}
                      {project.code ? <span className="text-slate-500"> · {project.code}</span> : null}
                    </Link>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">Not on any project</span>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {employee ? (
          <section aria-label="Assign an assessment" className={`${SECTION_CLASS} p-5`}>
            <h2 className="text-base font-semibold text-white">Assign an assessment</h2>
            <p className="mt-1 text-sm text-slate-400">
              {isInactive
                ? "This employee is inactive. Reactivate them to assign new assessments."
                : "Published employee assessments this employee doesn't have yet. To reach a whole department or project, use Assign on the "}
              {isInactive ? null : (
                <>
                  <Link href={buildAuthUrl("/assessments", searchParams)} className="text-cyan-300 hover:text-cyan-200">
                    Assessments
                  </Link>{" "}
                  page.
                </>
              )}
            </p>
            {isInactive ? null : (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <select
                  value={selectedAssessmentId}
                  onChange={(e) => setSelectedAssessmentId(e.target.value)}
                  aria-label="Assessment"
                  className={`${FIELD_CLASS} sm:w-80`}
                >
                  <option value="">{assignable.length ? "Select an assessment" : "No unassigned published assessments"}</option>
                  {assignable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} ({formatLabel(a.activityType)})
                    </option>
                  ))}
                </select>
                <button type="button" onClick={handleAssign} disabled={assigning || !selectedAssessmentId} className={PRIMARY_BUTTON}>
                  {assigning ? "Assigning..." : "Assign"}
                </button>
              </div>
            )}
          </section>
        ) : null}

        <section aria-label="Assessment history" className={SECTION_CLASS}>
          <div className="border-b border-slate-800 px-4 py-4 lg:px-5">
            <h2 className="text-base font-semibold text-white">Assessment History</h2>
            <p className="mt-0.5 text-xs text-slate-400">Kept even if the employee later changes department, leaves a project or is deactivated.</p>
          </div>
          <div className="hv-table-scroll">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="bg-slate-950 text-slate-500 shadow-[0_1px_0_var(--color-slate-800)]">
                <tr className={TABLE_HEAD_ROW}>
                  <th className="pl-5 pr-3 text-left">Assessment</th>
                  <th className="px-3 text-left">Status</th>
                  <th className="px-3 text-left">Assigned</th>
                  <th className="px-3 text-left">Completed</th>
                  <th className="px-3 text-right">Score</th>
                  <th className="px-3 text-left">Result</th>
                  <th className="pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-slate-400">Loading...</td>
                  </tr>
                ) : activities.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-slate-400">No assessments assigned yet.</td>
                  </tr>
                ) : (
                  activities.map((activity) => (
                    <tr key={activity.inviteId} className="border-t border-slate-800/80 text-slate-200 first:border-t-0 hover:bg-slate-800/25">
                      <td className="py-3 pl-5 pr-3">
                        <span className="font-semibold text-white">{activity.title ?? "-"}</span>
                        <span className="block text-xs text-slate-400">{formatLabel(activity.activityType)}</span>
                      </td>
                      <td className="px-3 py-3">
                        <AssignmentPill inviteStatus={activity.inviteStatus} attemptStatus={activity.attemptStatus} expired={activity.expired} />
                      </td>
                      <td className="px-3 py-3 text-slate-400">{formatDate(activity.assignedAt)}</td>
                      <td className="px-3 py-3 text-slate-400">{activity.completedAt ? formatDate(activity.completedAt) : "-"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPercent(activity.percentage)}</td>
                      <td className="px-3 py-3">
                        <ResultPill passed={activity.passed} />
                      </td>
                      <td className="py-3 pl-3 pr-5 text-right">
                        {activity.attemptId ? (
                          <Link
                            href={buildAuthUrl(`/assessments/${activity.assessmentId}/results/${activity.attemptId}/review`, searchParams)}
                            className={ROW_ACTION}
                          >
                            {activity.completedAt ? "Review" : "View"}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-500">Not started</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <AddEmployeeModal open={editOpen} employee={employee} onClose={() => setEditOpen(false)} onSaved={() => load()} />
    </div>
  )
}
