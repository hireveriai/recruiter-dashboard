"use client"

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

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href={buildAuthUrl("/assessments", searchParams)} className="text-sm text-slate-400 hover:text-white">
              &larr; Back to Assessments
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{assessmentTitle || "Results"}</h1>
            <p className="mt-1 text-sm text-slate-400">Candidate scores, pass/fail, and integrity risk.</p>
          </div>
          <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <AssessmentWorkflowPanel
          className="mt-5"
          assessmentId={id}
          isPublished={assessment?.status === "PUBLISHED"}
          hasQuestions={(assessment?.versions ?? []).some((v) => (v.questions?.length ?? 0) > 0)}
          hasInvites={inviteCount > 0}
          hasResults={results.length > 0}
        />

        <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-800 bg-slate-900/40">
          <div className="hv-table-scroll">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-950/20 text-slate-400">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Participant</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Job</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Score</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Pass/Fail</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Integrity Risk</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Sent</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Completed</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="p-10 text-center text-slate-400">Loading results...</td></tr>
                ) : results.length === 0 ? (
                  <tr><td colSpan={9} className="p-10 text-center text-slate-400">No completed attempts yet.</td></tr>
                ) : (
                  results.map((row) => (
                    <tr key={row.id} className="border-t border-slate-800/80 text-slate-200">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{row.employee?.fullName ?? row.candidate?.fullName ?? "-"}</div>
                        <div className="text-xs text-slate-500">{row.employee?.email ?? row.candidate?.email ?? ""}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{row.jobTitle ?? "-"}</td>
                      <td className="px-4 py-3 text-slate-300">{row.status}</td>
                      <td className="px-4 py-3 text-slate-200">{row.percentage != null ? `${Number(row.percentage)}%` : "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${passTone(row.passed)}`}>
                          {row.passed === true ? "PASSED" : row.passed === false ? "FAILED" : "PENDING"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${riskTone(row.riskLevel)}`}>
                          {formatRiskLevel(row.riskLevel)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{row.sentAt ? formatDate(row.sentAt) : "-"}</td>
                      <td className="px-4 py-3 text-slate-400">{row.completedAt ? formatDate(row.completedAt) : "-"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={buildAuthUrl(`/assessments/${id}/results/${row.attemptId}`, searchParams)}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 transition hover:text-white"
                          >
                            View
                          </Link>
                          {row.employee ? (
                            <Link
                              href={buildAuthUrl(`/assessments/${id}/results/${row.attemptId}/review`, searchParams)}
                              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-500/20"
                            >
                              Review
                            </Link>
                          ) : null}
                        </div>
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
