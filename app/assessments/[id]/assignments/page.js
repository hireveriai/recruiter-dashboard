"use client"

import Link from "next/link"
import { use as usePromise, useCallback, useEffect, useState } from "react"

import AssignAssessmentModal from "@/components/AssignAssessmentModal"
import Navbar from "@/components/Navbar"
import {
  AssignmentPill,
  FIELD_CLASS,
  PRIMARY_BUTTON,
  Pagination,
  ROW_ACTION,
  ResultPill,
  SECTION_CLASS,
  TABLE_HEAD_ROW,
  apiRequest,
  formatPercent,
} from "@/components/employees/shared"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDate } from "@/lib/client/date-format"
import { formatLabel } from "@/lib/client/format-label"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

const PAGE_SIZE = 25
const FILTERS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "COMPLETED", label: "Completed" },
]

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{value}</p>
    </div>
  )
}

/** Employee-level assignment status and results for one employee assessment. */
export default function AssessmentAssignmentsPage({ params }) {
  const { id } = usePromise(params)
  const searchParams = useAuthSearchParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("")
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [page, setPage] = useState(1)
  const [assignOpen, setAssignOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => setPage(1), [debounced, status])

  const load = useCallback(() => {
    setLoading(true)
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (status) query.set("status", status)
    if (debounced) query.set("search", debounced)
    apiRequest(`/api/assessments/${id}/assignments?${query.toString()}`, searchParams)
      .then((res) => {
        if (res.ok) {
          setData(res.data)
          setError(null)
        } else {
          setError(res.error?.message || "Could not load assignments")
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page, status, debounced])

  useEffect(() => {
    load()
  }, [load])

  const assessment = data?.assessment
  const summary = data?.summary
  const rows = data?.assignments ?? []
  const emptyMessage = loading && !data
    ? "Loading assignments..."
    : error
      ? error
      : rows.length === 0
        ? status || debounced
          ? "No assignments match these filters."
          : "Not assigned to anyone yet."
        : null

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <header className="min-w-0 max-w-3xl">
            <Link href={buildAuthUrl("/assessments", searchParams)} className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300 hover:text-cyan-200">
              &larr; Assessments
            </Link>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
              {assessment?.title ?? (error ? "Assessment unavailable" : "Loading...")}
            </h1>
            {assessment ? (
              <p className="mt-1 text-sm text-slate-400">
                {formatLabel(assessment.activityType)} · {assessment.durationMinutes} min · Pass mark {Number(assessment.passingPercentage)}% · Created{" "}
                {formatDate(assessment.createdAt)}
                {data?.target ? (
                  <>
                    {" "}· Target <span className="text-slate-200">{data.target.label}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </header>
          {assessment ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={buildAuthUrl(`/assessments/${id}/questions`, searchParams)}
                className="inline-flex items-center rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Questions
              </Link>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={assessment.status !== "PUBLISHED"}
                title={assessment.status !== "PUBLISHED" ? "Publish this assessment before assigning it" : undefined}
                onClick={() => setAssignOpen(true)}
              >
                Assign
              </button>
            </div>
          ) : null}
        </div>

        {summary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Assigned" value={summary.assigned} />
            <StatCard label="Completed" value={summary.completed} />
            <StatCard label="Pending" value={summary.pending} />
            <StatCard label="Average score" value={formatPercent(summary.averageScore)} />
            <StatCard label="Pass rate" value={formatPercent(summary.passRate)} />
          </div>
        ) : null}

        <section aria-label="Employee results" className={SECTION_CLASS}>
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-5">
            <h2 className="text-base font-semibold text-white">Employees</h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div role="tablist" aria-label="Assignment status" className="inline-flex w-fit rounded-xl border border-slate-800 bg-slate-950/40 p-1">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    role="tab"
                    aria-selected={status === filter.value}
                    onClick={() => setStatus(filter.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      status === filter.value ? "hv-solid-action bg-cyan-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employees"
                aria-label="Search employees"
                className={`${FIELD_CLASS} h-9 text-[13px] sm:w-60`}
              />
            </div>
          </div>

          <div className="hv-table-scroll">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead className="bg-slate-950 text-slate-500 shadow-[0_1px_0_var(--color-slate-800)]">
                <tr className={TABLE_HEAD_ROW}>
                  <th className="pl-5 pr-3 text-left">Employee</th>
                  <th className="px-3 text-left">Employee ID</th>
                  <th className="px-3 text-left">Department</th>
                  <th className="px-3 text-left">Status</th>
                  <th className="px-3 text-right">Score</th>
                  <th className="px-3 text-left">Result</th>
                  <th className="px-3 text-left">Assigned</th>
                  <th className="px-3 text-left">Completed</th>
                  <th className="pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {emptyMessage ? (
                  <tr>
                    <td colSpan={9} className="p-10 text-center text-slate-400">{emptyMessage}</td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.inviteId} className="border-t border-slate-800/80 text-slate-200 first:border-t-0 hover:bg-slate-800/25">
                      <td className="py-3 pl-5 pr-3">
                        <Link href={buildAuthUrl(`/employees/${row.employee.id}`, searchParams)} className="font-semibold text-white hover:text-cyan-200">
                          {row.employee.fullName}
                        </Link>
                        <span className="block text-xs text-slate-400">
                          {row.employee.email}
                          {row.employee.status === "INACTIVE" ? " · inactive" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-400">{row.employee.employeeCode ?? "-"}</td>
                      <td className="px-3 py-3 text-slate-300">{row.employee.department ?? "-"}</td>
                      <td className="px-3 py-3">
                        <AssignmentPill inviteStatus={row.inviteStatus} attemptStatus={row.attemptStatus} expired={row.expired} />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPercent(row.percentage)}</td>
                      <td className="px-3 py-3">
                        <ResultPill passed={row.passed} />
                      </td>
                      <td className="px-3 py-3 text-slate-400">{formatDate(row.assignedAt)}</td>
                      <td className="px-3 py-3 text-slate-400">{row.completedAt ? formatDate(row.completedAt) : "-"}</td>
                      <td className="py-3 pl-3 pr-5 text-right">
                        {row.attemptId ? (
                          <Link
                            href={buildAuthUrl(`/assessments/${id}/results/${row.attemptId}/review`, searchParams)}
                            className={ROW_ACTION}
                          >
                            {row.completedAt ? "Review" : "View"}
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
          <Pagination meta={data?.meta} onPage={setPage} label="employees" />
        </section>
      </main>

      <AssignAssessmentModal
        open={assignOpen}
        assessment={assessment}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => load()}
      />
    </div>
  )
}
