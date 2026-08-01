"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl, hasAuthQuery } from "@/lib/client/auth-query"
import { TableSkeleton } from "@/components/system/skeletons"
import { CandidateActionModal } from "@/components/dashboard/CandidateActionModal"
import { DecisionPill } from "@/components/dashboard/DecisionPill"

import CandidateInsightModal from "./CandidateInsightModal"

const DASHBOARD_INVALIDATED_EVENT = "hireveri:dashboard-data-invalidated"

function getStatusColor(status) {
  const normalized = String(status ?? "PENDING").toUpperCase()

  if (normalized === "COMPLETED") {
    return "text-green-400"
  }

  if (normalized === "IN_PROGRESS") {
    return "text-blue-400"
  }

  if (normalized === "SCREENED" || normalized === "READY") {
    return "text-cyan-300"
  }

  if (normalized === "SCREENING_FAILED") {
    return "text-red-400"
  }

  if (normalized === "EXPIRED") {
    return "text-red-300"
  }

  return "text-yellow-400"
}

function getScoreColor(score) {
  if (score === null || score === undefined) {
    return "text-gray-300"
  }

  if (score > 80) {
    return "text-green-400"
  }

  if (score >= 60) {
    return "text-yellow-400"
  }

  return "text-red-400"
}

function formatScore(score) {
  if (score === null || score === undefined) {
    return "-"
  }

  return `${Math.round(score)}%`
}

function formatStatusLabel(status) {
  return String(status ?? "PENDING")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function isDecisionReady(candidate) {
  const status = String(candidate.status ?? "").toUpperCase()
  return Boolean(candidate.endedAt || candidate.score !== null || candidate.decision || ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(status))
}

function isCompletedCandidate(candidate) {
  const status = String(candidate?.status ?? "").toUpperCase()
  return Boolean(candidate?.endedAt || ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(status))
}

export default function CandidateList({ initialCandidates, isLoading = false }) {
  const searchParams = useAuthSearchParams()
  const [candidates, setCandidates] = useState(() => initialCandidates ?? [])
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [reviewCandidate, setReviewCandidate] = useState(null)
  const [decisionOverrides, setDecisionOverrides] = useState({})
  const sourceCandidates = candidates
  const displayCandidates = sourceCandidates.map((candidate) => {
    const key = candidate.interviewId || candidate.candidateId
    return decisionOverrides[key]
      ? { ...candidate, recruiterDecisionStatus: decisionOverrides[key].status, recruiterDecisionNotes: decisionOverrides[key].notes }
      : candidate
  })
  const previewCandidates = displayCandidates.slice(0, 5)

  function handleDecisionSaved(candidate, decision) {
    const key = candidate.interviewId || candidate.candidateId
    setDecisionOverrides((current) => ({
      ...current,
      [key]: { status: decision.status, notes: decision.notes ?? candidate.recruiterDecisionNotes ?? null },
    }))
    setCandidates((current) => current.map((item) => {
      const itemKey = item.interviewId || item.candidateId
      return itemKey === key
        ? {
            ...item,
            recruiterDecisionStatus: decision.status,
            recruiterDecisionAt: decision.decidedAt,
            recruiterDecisionNotes: decision.notes ?? item.recruiterDecisionNotes ?? null,
          }
        : item
    }))
  }

  useEffect(() => {
    if (initialCandidates !== undefined) {
      queueMicrotask(() => setCandidates(initialCandidates ?? []))
    }
  }, [initialCandidates])

  useEffect(() => {
    if (initialCandidates !== undefined) {
      return
    }

    if (!hasAuthQuery(searchParams)) {
      return
    }

    let isMounted = true

    fetch(buildAuthUrl("/api/dashboard/candidates", searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.success) {
          setCandidates(data.data ?? [])
        }
      })
      .catch((error) => {
        console.error("Failed to fetch dashboard candidates", error)
      })

    return () => {
      isMounted = false
    }
  }, [initialCandidates, searchParams])

  useEffect(() => {
    if (!hasAuthQuery(searchParams) || typeof window === "undefined") {
      return undefined
    }

    let refreshTimer = null

    function refreshCandidates() {
      fetch(buildAuthUrl(`/api/dashboard/candidates?limit=5&refresh=${Date.now()}`, searchParams), {
        credentials: "include",
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setCandidates(data.data ?? [])
          }
        })
        .catch((error) => {
          console.error("Failed to refresh dashboard candidates", error)
        })
    }

    function handleDashboardInvalidated() {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(refreshCandidates, 175)
    }

    window.addEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      window.removeEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)
    }
  }, [searchParams])

  return (
    <>
      <div className="mt-10">
        <div className="flex justify-between items-center mb-4">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            Candidates
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Recent
            </span>
          </h2>

          <Link href="/candidates" className="text-blue-400 text-sm">
            View All
          </Link>
        </div>

      <div className="hv-theme-panel overflow-x-auto rounded-lg bg-[#111a2e]">
          <table className="w-full min-w-[980px] table-fixed text-[13px] sm:text-sm">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[30%]" />
              <col className="w-[14%]" />
              <col className="w-[20%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="text-gray-400 border-b border-gray-700">
              <tr>
                <th className="px-4 py-4 text-left align-middle">Candidate</th>
                <th className="px-4 py-4 text-left align-middle">Job</th>
                <th className="px-4 py-4 text-left align-middle">Status</th>
                <th className="whitespace-nowrap px-4 py-4 text-left align-middle">VERIS Screening Score</th>
                <th className="px-4 py-4 text-left align-middle">Action</th>
              </tr>
            </thead>

            {isLoading ? (
              <TableSkeleton rows={5} columns={5} showAvatar />
            ) : (
              <tbody>
                {displayCandidates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-gray-400 text-center">
                    No candidates available
                  </td>
                </tr>
              ) : (
                previewCandidates.map((candidate, index) => (
                  <tr key={`${candidate.candidateName}-${index}`} className="border-b border-gray-800">
                    <td className="px-4 py-4 align-middle">
                      <span className="block truncate font-semibold text-white">{candidate.candidateName}</span>
                      {candidate.aiSummaryFull && isCompletedCandidate(candidate) ? (
                        <button
                          type="button"
                          className="mt-1 block max-w-full truncate text-left text-xs font-medium text-cyan-300/80 transition hover:text-cyan-100"
                          onClick={() => setSelectedCandidate(candidate)}
                          title={candidate.aiSummaryShort}
                        >
                          View VERIS insight
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 align-middle text-gray-300"><span className="block truncate">{candidate.jobTitle}</span></td>
                    <td className={`px-4 py-4 align-middle ${getStatusColor(candidate.status)}`}><span className="block truncate">{formatStatusLabel(candidate.status)}</span></td>
                    <td className={`px-4 py-4 align-middle ${getScoreColor(candidate.verisScreeningScore)}`}>
                      {formatScore(candidate.verisScreeningScore)}
                    </td>
                    <td className="px-4 py-4 align-middle">
                      {candidate.interviewId && isDecisionReady(candidate) ? (
                        candidate.recruiterDecisionStatus ? (
                          <DecisionPill status={candidate.recruiterDecisionStatus} />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setReviewCandidate(candidate)}
                            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-400/15 hover:text-white"
                            aria-label={`Take hiring action for ${candidate.candidateName}`}
                          >
                            Take Action
                          </button>
                        )
                      ) : (
                        <span className="inline-flex max-w-full rounded-full border border-slate-600/70 bg-slate-950/30 px-3 py-1 text-xs font-medium leading-5 text-slate-400">
                          After completion
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
              </tbody>
            )}
          </table>
        </div>
      </div>

      <CandidateInsightModal
        isOpen={Boolean(selectedCandidate)}
        onClose={() => setSelectedCandidate(null)}
        candidateName={selectedCandidate?.candidateName}
        summary={selectedCandidate?.aiSummaryFull}
      />
      <CandidateActionModal
        isOpen={Boolean(reviewCandidate)}
        candidate={reviewCandidate}
        searchParams={searchParams}
        onClose={() => setReviewCandidate(null)}
        onDecisionSaved={(decision) => {
          if (reviewCandidate) {
            handleDecisionSaved(reviewCandidate, decision)
          }
        }}
      />
    </>
  )
}




