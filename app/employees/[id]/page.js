"use client"

import Link from "next/link"
import { use as usePromise, useEffect, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDate } from "@/lib/client/date-format"
import { showActionFeedback } from "@/lib/client/action-feedback"

function activityStatusLabel(inviteStatus, attemptStatus) {
  if (attemptStatus === "SUBMITTED" || attemptStatus === "TIMED_OUT") return "Completed"
  if (attemptStatus === "IN_PROGRESS") return "In Progress"
  if (inviteStatus === "OPENED") return "Opened"
  return "Assigned"
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

  const load = () => {
    setLoading(true)
    fetch(buildAuthUrl(`/api/employees/${id}/activities`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setEmployee(data?.data?.employee ?? null)
        setActivities(Array.isArray(data?.data?.activities) ? data.data.activities : [])
      })
      .catch(() => {
        setEmployee(null)
        setActivities([])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    fetch(buildAuthUrl("/api/assessments?participantType=EMPLOYEE&status=PUBLISHED&pageSize=100", searchParams), {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => setAvailableActivities(Array.isArray(data?.data?.assessments) ? data.data.assessments : []))
      .catch(() => setAvailableActivities([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleAssign = async () => {
    if (!selectedAssessmentId) {
      showActionFeedback({ tone: "error", title: "Pick an activity", message: "Select a published Employee activity to assign." })
      return
    }
    try {
      setAssigning(true)
      const res = await fetch(buildAuthUrl(`/api/assessments/${selectedAssessmentId}/invite`, searchParams), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: id }),
      })
      const data = await res.json()
      if (!res.ok) {
        showActionFeedback({ tone: "error", title: "Assign failed", message: data?.error?.message || "Failed to assign activity" })
        return
      }
      showActionFeedback({ tone: "success", title: "Activity assigned", message: "The employee has been notified by email." })
      setSelectedAssessmentId("")
      load()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Assign failed", message: err instanceof Error ? err.message : "Something went wrong" })
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1200px] px-4 py-7 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href={buildAuthUrl("/employees", searchParams)} className="text-xs font-semibold uppercase tracking-[0.34em] text-violet-300/75 hover:text-violet-200">
              &larr; Employees
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {employee?.fullName ?? (loading ? "Loading..." : "Employee not found")}
            </h1>
            {employee && (
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {employee.email} {employee.title ? `· ${employee.title}` : ""} {employee.department ? `· ${employee.department}` : ""}
              </p>
            )}
          </div>
          <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <div className="mt-6 rounded-[24px] border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Assign an Activity</h2>
          <p className="mt-1 text-sm text-slate-500">
            Only published Employee-participant Assessments/Challenges/Tasks show up here — create one from{" "}
            <Link href={buildAuthUrl("/assessments", searchParams)} className="text-violet-300 underline-offset-4 hover:underline">
              Assessment
            </Link>{" "}
            with Participant set to Employee, then publish it.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select
              value={selectedAssessmentId}
              onChange={(e) => setSelectedAssessmentId(e.target.value)}
              className="h-11 min-w-[280px] rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-200 outline-none focus:border-violet-400/60"
            >
              <option value="">Select an activity</option>
              {availableActivities.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.activityType}] {a.title}
                </option>
              ))}
            </select>
            <button
              onClick={handleAssign}
              disabled={assigning}
              className="rounded-full bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(167,139,250,0.35)] transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {assigning ? "Assigning..." : "Assign"}
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-800 bg-slate-900/40">
          <div className="hv-table-scroll">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-950/20 text-slate-400">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Activity</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Type</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Score</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Due</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="p-10 text-center text-slate-400">Loading...</td></tr>
                ) : activities.length === 0 ? (
                  <tr><td colSpan={6} className="p-10 text-center text-slate-400">No activities assigned yet.</td></tr>
                ) : (
                  activities.map((activity) => (
                    <tr key={activity.inviteId} className="border-t border-slate-800/80 text-slate-200">
                      <td className="px-4 py-3 font-medium text-white">{activity.title ?? "-"}</td>
                      <td className="px-4 py-3 text-slate-400">{activity.activityType}</td>
                      <td className="px-4 py-3 text-slate-300">{activityStatusLabel(activity.inviteStatus, activity.attemptStatus)}</td>
                      <td className="px-4 py-3 text-slate-300">{activity.percentage != null ? `${Math.round(Number(activity.percentage))}%` : "-"}</td>
                      <td className="px-4 py-3 text-slate-400">{formatDate(activity.expiresAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {activity.attemptId ? (
                          <Link
                            href={buildAuthUrl(`/assessments/${activity.assessmentId}/results/${activity.attemptId}/review`, searchParams)}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 transition hover:text-white"
                          >
                            {activity.completedAt ? "Review" : "View"}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-600">Not started</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
