"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDate } from "@/lib/client/date-format"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

function statusTone(status) {
  if (status === "PUBLISHED") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
  if (status === "ARCHIVED") return "border-slate-700 bg-slate-800/60 text-slate-400"
  return "border-amber-500/30 bg-amber-500/10 text-amber-200"
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/35 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  )
}

/**
 * VERIS Assessment's own dashboard summary -- shown in place of the
 * Interview Pipeline / Recorded Interviews / Candidates widgets for an org
 * whose only entitlement is ASSESSMENT (see app/page.js), so that workspace
 * isn't left with a near-empty dashboard.
 */
export default function AssessmentSummary({ isLoading = false }) {
  const searchParams = useAuthSearchParams()
  const [summary, setSummary] = useState(null)
  const [isFetching, setIsFetching] = useState(true)

  useEffect(() => {
    let active = true

    fetch(buildAuthUrl(`/api/dashboard/assessments?refresh=${Date.now()}`, searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (active && data.success) {
          setSummary(data.data)
        }
      })
      .catch((error) => {
        console.error("Failed to fetch assessment dashboard summary", error)
      })
      .finally(() => {
        if (active) {
          setIsFetching(false)
        }
      })

    return () => {
      active = false
    }
  }, [searchParams])

  const isBusy = isLoading || isFetching
  const recent = summary?.recent ?? []

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            VERIS Assessment
            <span className="hv-recent-chip ml-2 align-middle">Recent</span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">Scored skills tests sent to candidates</p>
        </div>

        <Link
          href={buildAuthUrl("/assessments", searchParams)}
          className="self-start rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-violet-400/40 hover:text-white sm:self-auto"
        >
          Go to Assessments
        </Link>
      </div>

      {isBusy ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-8 text-center text-sm text-slate-400">
          Loading assessment activity...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(180px,220px))]">
            <StatTile label="Assessments" value={summary?.totalAssessments ?? 0} />
            <StatTile label="Published" value={summary?.publishedAssessments ?? 0} />
            <StatTile label="Invites Sent" value={summary?.invitesSent ?? 0} />
            <StatTile
              label="Pass Rate"
              value={summary?.passRate === null || summary?.passRate === undefined ? "-" : `${summary.passRate}%`}
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
            {recent.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">
                No assessments yet.{" "}
                <Link href={buildAuthUrl("/assessments", searchParams)} className="text-violet-300 hover:text-violet-200">
                  Create one to get started.
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/80">
                {recent.map((assessment) => (
                  <li key={assessment.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={buildAuthUrl(`/assessments/${assessment.id}/results`, searchParams)}
                        className="truncate text-sm font-medium text-white hover:text-violet-200 hover:underline"
                      >
                        {assessment.title}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {assessment.invitesSent} sent · {assessment.completedAttempts} completed · {formatDate(assessment.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] ${statusTone(assessment.status)}`}
                    >
                      {assessment.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
