"use client"
import { formatLabel } from "@/lib/client/format-label"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDate } from "@/lib/client/date-format"
import { AssessmentWorkflowPanel } from "@/components/AssessmentWorkflowGuide"

// Only these four labels are ever used for integrity risk - never language
// implying proven cheating, since AssessmentSignal counts are heuristic.
// The DB stores the raw enum (LOW | MODERATE | HIGH | REVIEW_RECOMMENDED,
// no "RISK" suffix) - format it for display rather than rendering verbatim.
function formatRiskLevel(riskLevel) {
  if (!riskLevel) return "-"
  if (riskLevel === "REVIEW_RECOMMENDED") return "REVIEW RECOMMENDED"
  if (riskLevel === "LOW") return "LOW RISK"
  if (riskLevel === "MODERATE") return "MODERATE RISK"
  if (riskLevel === "HIGH") return "HIGH RISK"
  return riskLevel.replace(/_/g, " ")
}

function riskTone(riskLevel) {
  if (riskLevel === "REVIEW_RECOMMENDED") return "border-rose-500/30 bg-rose-500/12 text-rose-200"
  if (riskLevel === "HIGH") return "border-amber-500/30 bg-amber-500/12 text-amber-200"
  if (riskLevel === "MODERATE") return "border-amber-400/20 bg-amber-400/8 text-amber-100"
  return "border-emerald-500/30 bg-emerald-500/12 text-emerald-200"
}

function passTone(passed) {
  if (passed === true) return "border-emerald-500/30 bg-emerald-500/12 text-emerald-200"
  if (passed === false) return "border-rose-500/30 bg-rose-500/12 text-rose-200"
  return "border-slate-700 bg-slate-800/60 text-slate-400"
}

function participantName(row) {
  return row.employee?.fullName ?? row.candidate?.fullName ?? "-"
}

function participantEmail(row) {
  return row.employee?.email ?? row.candidate?.email ?? ""
}

function initials(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter((part) => part && part !== "-")
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "VN"
}

// Results table columns from lg up. Below lg each row is a stacked card.
const RESULT_COLUMNS =
  "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_7rem_4.5rem_6.5rem_9.5rem_6rem_6rem_8.5rem]"

export default function AssessmentResultsPage() {
  const { id } = useParams()
  const searchParams = useAuthSearchParams()
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [assessmentTitle, setAssessmentTitle] = useState("")
  const [assessment, setAssessment] = useState(null)
  const [inviteCount, setInviteCount] = useState(0)

  useEffect(() => {
    fetch(buildAuthUrl(`/api/assessments/${id}`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setAssessmentTitle(data?.data?.title ?? "")
        setAssessment(data?.data ?? null)
      })
      .catch(() => {})

    fetch(buildAuthUrl(`/api/assessments/${id}/invites?pageSize=1`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setInviteCount(Number(data?.data?.meta?.total ?? 0)))
      .catch(() => setInviteCount(0))

    fetch(buildAuthUrl(`/api/assessments/${id}/results`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setResults(Array.isArray(data?.data?.results) ? data.data.results : []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const scored = results.filter((row) => row.percentage != null)
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, row) => sum + Number(row.percentage), 0) / scored.length)
    : null
  const statCards = [
    ["Results", results.length],
    ["Average score", averageScore === null ? "-" : `${averageScore}%`],
    ["Passed", results.filter((row) => row.passed === true).length],
    ["Integrity review", results.filter((row) => row.riskLevel === "REVIEW_RECOMMENDED" || row.riskLevel === "HIGH").length],
  ]

  const renderActions = (row) => (
    <div className="flex items-center gap-2 lg:justify-end">
      <Link
        href={buildAuthUrl(`/assessments/${id}/results/${row.attemptId}`, searchParams)}
        className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/50 hover:text-white"
      >
        View
      </Link>
      {row.employee ? (
        <Link
          href={buildAuthUrl(`/assessments/${id}/results/${row.attemptId}/review`, searchParams)}
          className="hv-solid-action rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
        >
          Review
        </Link>
      ) : null}
    </div>
  )

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <header className="min-w-0">
            <Link href={buildAuthUrl("/assessments", searchParams)} className="text-sm text-slate-400 hover:text-white">
              &larr; Back to Assessments
            </Link>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Assessment results</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">{assessmentTitle || "Results"}</h1>
            <p className="mt-1 text-sm text-slate-400">Candidate scores, pass/fail, and integrity risk.</p>
          </header>
          <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <AssessmentWorkflowPanel
          assessmentId={id}
          isPublished={assessment?.status === "PUBLISHED"}
          hasQuestions={(assessment?.versions ?? []).some((v) => (v.questions?.length ?? 0) > 0)}
          hasInvites={inviteCount > 0}
          hasResults={results.length > 0}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3.5">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">{value}</p>
            </div>
          ))}
        </div>

        <section aria-label="Results" className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80">
          <div
            className={`hidden gap-3 border-b border-slate-800 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 lg:grid ${RESULT_COLUMNS}`}
          >
            <span>Participant</span>
            <span>Job</span>
            <span>Status</span>
            <span>Score</span>
            <span>Pass/Fail</span>
            <span>Integrity Risk</span>
            <span>Sent</span>
            <span>Completed</span>
            <span className="text-right">Detail</span>
          </div>

          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Loading results...</p>
          ) : results.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">No completed attempts yet.</p>
          ) : (
            <ul>
              {results.map((row) => (
                <li
                  key={row.id}
                  className={`grid grid-cols-2 items-center gap-x-3 gap-y-2.5 border-b border-slate-800/80 px-4 py-4 text-sm text-slate-200 transition-colors last:border-b-0 hover:bg-slate-800/30 lg:gap-3 lg:px-5 lg:py-3 ${RESULT_COLUMNS}`}
                >
                  <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-cyan-400/15 text-xs font-semibold text-cyan-200">
                      {initials(participantName(row))}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{participantName(row)}</p>
                      <p className="truncate text-xs text-slate-500">{participantEmail(row)}</p>
                    </div>
                  </div>
                  <p className="col-span-2 truncate text-slate-400 lg:col-span-1">{row.jobTitle ?? "-"}</p>
                  <p className="text-slate-300">
                    <span className="mr-1 text-[10px] uppercase tracking-[0.12em] text-slate-500 lg:hidden">Status</span>
                    {formatLabel(row.status, "-")}
                  </p>
                  <p className="text-right font-semibold tabular-nums text-white lg:text-left">
                    <span className="mr-1 text-[10px] font-normal uppercase tracking-[0.12em] text-slate-500 lg:hidden">Score</span>
                    {row.percentage != null ? `${Number(row.percentage)}%` : "-"}
                  </p>
                  <div>
                    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${passTone(row.passed)}`}>
                      {row.passed === true ? "PASSED" : row.passed === false ? "FAILED" : "PENDING"}
                    </span>
                  </div>
                  <div className="justify-self-end lg:justify-self-start">
                    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${riskTone(row.riskLevel)}`}>
                      {formatRiskLevel(row.riskLevel)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    <span className="mr-1 uppercase tracking-[0.12em] text-slate-500 lg:hidden">Sent</span>
                    {row.sentAt ? formatDate(row.sentAt) : "-"}
                  </p>
                  <p className="text-right text-xs text-slate-400 lg:text-left">
                    <span className="mr-1 uppercase tracking-[0.12em] text-slate-500 lg:hidden">Completed</span>
                    {row.completedAt ? formatDate(row.completedAt) : "-"}
                  </p>
                  <div className="col-span-2 lg:col-span-1">{renderActions(row)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
