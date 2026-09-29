"use client"
import { formatLabel } from "@/lib/client/format-label"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import FeatureLockedNotice from "@/components/FeatureLockedNotice"
import Navbar from "@/components/Navbar"
import CreateAssessmentModal from "@/components/CreateAssessmentModal"
import SendAssessmentModal from "@/components/SendAssessmentModal"
import { AssessmentFlowGuide } from "@/components/AssessmentWorkflowGuide"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDate } from "@/lib/client/date-format"

/**
 * This list page shows Assessment *definitions* (Draft/Published/Archived),
 * one row per Assessment, rather than one row per invite/attempt. That
 * matches how the equivalent Jobs list works, keeps this page backed by the
 * existing GET /api/assessments endpoint without needing a new cross-
 * assessment invite/attempt aggregate, and lets the recruiter drill into a
 * specific assessment's Invites/Results tabs (candidate-level detail lives on
 * app/assessments/[id]/results) for the "who did what" view.
 */

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
]

function statusTone(status) {
  if (status === "PUBLISHED") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
  if (status === "ARCHIVED") return "border-slate-700 bg-slate-800/60 text-slate-400"
  return "border-amber-500/30 bg-amber-500/10 text-amber-300"
}

function statusDot(status) {
  if (status === "PUBLISHED") return "bg-emerald-400"
  if (status === "ARCHIVED") return "bg-slate-500"
  return "bg-amber-400"
}

function titleInitials(title) {
  const words = String(title ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean)
  if (words.length === 0) return "A"
  return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : "")).toUpperCase()
}

const rowAction =
  "inline-flex h-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-100"

export default function AssessmentsPage() {
  const searchParams = useAuthSearchParams()
  const [status, setStatus] = useState("")
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(true)
  const [openCreate, setOpenCreate] = useState(false)
  const [openSend, setOpenSend] = useState(false)
  const [editing, setEditing] = useState(null)
  const [lockedFeature, setLockedFeature] = useState(null)
  const [flowSummary, setFlowSummary] = useState(null)
  const [flowLoading, setFlowLoading] = useState(true)
  // Client-side search over the loaded list; the status tabs still filter on the server.
  const [searchTerm, setSearchTerm] = useState("")

  // Org-wide progress for the Assessment Flow strip. Cache-busted because the
  // endpoint allows a short private cache and this refreshes right after the
  // recruiter creates or sends something.
  const loadFlowSummary = () => {
    fetch(buildAuthUrl(`/api/dashboard/assessments?t=${Date.now()}`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.success) setFlowSummary(data.data)
      })
      .catch(() => {})
      .finally(() => setFlowLoading(false))
  }

  useEffect(() => {
    loadFlowSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadAssessments = () => {
    setLoading(true)
    const query = status
      ? `?status=${status}&pageSize=100&participantType=CANDIDATE`
      : "?pageSize=100&participantType=CANDIDATE"
    fetch(buildAuthUrl(`/api/assessments${query}`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.error?.code === "FEATURE_NOT_IN_PLAN") {
          setLockedFeature(data.error.entitlement || "ASSESSMENT")
          return
        }

        setAssessments(Array.isArray(data?.data?.assessments) ? data.data.assessments : [])
      })
      .catch(() => setAssessments([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadAssessments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const tabs = useMemo(() => STATUS_TABS, [])

  const query = searchTerm.trim().toLowerCase()
  const visibleAssessments = query
    ? assessments.filter((item) => `${item.title ?? ""} ${item.jobTitle ?? ""}`.toLowerCase().includes(query))
    : assessments
  const emptyMessage = loading
    ? "Loading assessments..."
    : assessments.length === 0
      ? "No assessments yet. Create one to get started."
      : visibleAssessments.length === 0
        ? "No assessments match your search."
        : null

  const renderStatus = (value) => (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusTone(value)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${statusDot(value)}`} aria-hidden="true" />
      {formatLabel(value)}
    </span>
  )

  const renderTitle = (assessment) => (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
          assessment.status === "PUBLISHED" ? "bg-cyan-400/15 text-cyan-200" : "bg-slate-800 text-slate-400"
        }`}
      >
        {titleInitials(assessment.title)}
      </span>
      <div className="min-w-0">
        <Link
          href={buildAuthUrl(`/assessments/${assessment.id}/questions`, searchParams)}
          className="block truncate text-sm font-semibold text-white underline-offset-4 hover:text-cyan-200 hover:underline"
          title={assessment.title}
        >
          {assessment.title}
        </Link>
        <p className="truncate text-xs text-slate-400">{assessment.jobTitle ?? "No linked job"}</p>
      </div>
    </div>
  )

  const renderActions = (assessment) => (
    <div className="flex items-center justify-end gap-2">
      <Link href={buildAuthUrl(`/assessments/${assessment.id}/questions`, searchParams)} className={rowAction}>
        Questions
      </Link>
      <Link href={buildAuthUrl(`/assessments/${assessment.id}/results`, searchParams)} className={rowAction}>
        Results
      </Link>
      <button
        onClick={() => {
          setEditing(assessment)
          setOpenCreate(true)
        }}
        className={rowAction}
      >
        Edit
      </button>
    </div>
  )

  if (lockedFeature) {
    return <FeatureLockedNotice feature={lockedFeature} />
  }

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <header className="min-w-0 max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Assessment</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">Assessments</h1>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Scored skills tests, independent of Screening and the AI Interview. Create, generate questions, publish, and send.
            </p>
          </header>
          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
            <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
            <button
              onClick={() => setOpenSend(true)}
              className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
            >
              Send Assessment
            </button>
            <button
              onClick={() => {
                setEditing(null)
                setOpenCreate(true)
              }}
              className="hv-solid-action inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              <span aria-hidden="true" className="text-base leading-none">+</span>
              Create Assessment
            </button>
          </div>
        </div>

        <AssessmentFlowGuide
          summary={flowSummary}
          loading={flowLoading}
          hrefFor={(path) => buildAuthUrl(path, searchParams)}
          onCreate={() => {
            setEditing(null)
            setOpenCreate(true)
          }}
          onSend={() => setOpenSend(true)}
          onShowDrafts={() => setStatus("DRAFT")}
        />

        <section
          aria-label="Assessment Library"
          className="hv-elevated-section overflow-clip rounded-xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)]"
        >
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-5">
            <div>
              <h2 className="text-base font-semibold text-white">Assessment Library</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {loading ? "Loading assessments..." : `Showing ${visibleAssessments.length} of ${assessments.length} assessments`}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div role="tablist" aria-label="Assessment status" className="inline-flex w-fit rounded-xl border border-slate-800 bg-slate-950/40 p-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.value}
                    role="tab"
                    aria-selected={status === tab.value}
                    onClick={() => setStatus(tab.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      status === tab.value ? "hv-solid-action bg-cyan-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search title or job"
                aria-label="Search assessments"
                className="h-9 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-[13px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10 sm:w-60"
              />
            </div>
          </div>

          {/* Register from lg up; cards below. */}
          <div className="relative hidden lg:block">
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col className="w-[38%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[19%]" />
              </colgroup>
              <thead className="sticky top-[77px] z-10 bg-slate-950 text-slate-500 shadow-[0_1px_0_var(--color-slate-800)]">
                <tr className="[&>th]:whitespace-nowrap [&>th]:py-2.5 [&>th]:text-[10.5px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.14em]">
                  <th className="pl-5 pr-3 text-left">Assessment</th>
                  <th className="px-3 text-left">Status</th>
                  <th className="px-3 text-left">Duration</th>
                  <th className="px-3 text-left">Pass mark</th>
                  <th className="px-3 text-left">Created</th>
                  <th className="pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {emptyMessage ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-slate-400">{emptyMessage}</td>
                  </tr>
                ) : (
                  visibleAssessments.map((assessment) => (
                    <tr key={assessment.id} className="border-t border-slate-800/80 align-middle text-slate-200 transition-colors first:border-t-0 hover:bg-slate-800/25">
                      <td className="py-3 pl-5 pr-3">{renderTitle(assessment)}</td>
                      <td className="px-3 py-3">{renderStatus(assessment.status)}</td>
                      <td className="px-3 py-3 tabular-nums text-slate-300">{assessment.durationMinutes} min</td>
                      <td className="px-3 py-3 tabular-nums text-slate-300">{Number(assessment.passingPercentage)}%</td>
                      <td className="px-3 py-3 text-slate-400">{formatDate(assessment.createdAt)}</td>
                      <td className="py-3 pl-3 pr-5">{renderActions(assessment)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {emptyMessage ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400 lg:hidden">{emptyMessage}</p>
          ) : (
            <ul className="lg:hidden" aria-label="Assessments">
              {visibleAssessments.map((assessment) => (
                <li key={assessment.id} className="border-t border-slate-800/80 px-4 py-4 first:border-t-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">{renderTitle(assessment)}</div>
                    {renderStatus(assessment.status)}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {assessment.durationMinutes} min <span className="text-slate-600">&middot;</span> Pass mark {Number(assessment.passingPercentage)}%{" "}
                    <span className="text-slate-600">&middot;</span> Created {formatDate(assessment.createdAt)}
                  </p>
                  <div className="mt-3 border-t border-slate-800/80 pt-3">{renderActions(assessment)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <CreateAssessmentModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        initialAssessment={editing}
        onSuccess={() => {
          loadAssessments()
          loadFlowSummary()
        }}
      />
      <SendAssessmentModal
        isOpen={openSend}
        onClose={() => {
          setOpenSend(false)
          loadFlowSummary()
        }}
      />
    </div>
  )
}
