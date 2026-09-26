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
  if (status === "PUBLISHED") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
  if (status === "ARCHIVED") return "border-slate-700 bg-slate-800/60 text-slate-400"
  return "border-amber-500/30 bg-amber-500/10 text-amber-200"
}

export default function AssessmentsPage() {
  const searchParams = useAuthSearchParams()
  const [status, setStatus] = useState("")
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(true)
  const [openCreate, setOpenCreate] = useState(false)
  const [openSend, setOpenSend] = useState(false)
  const [editing, setEditing] = useState(null)
  const [lockedFeature, setLockedFeature] = useState(null)

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

  if (lockedFeature) {
    return <FeatureLockedNotice feature={lockedFeature} />
  }

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-violet-300/75">VERIS Assessment</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Assessments</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Scored skills tests, independent of Screening and the AI Interview. Create, generate questions, publish, and send.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
            <button
              onClick={() => setOpenSend(true)}
              className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20"
            >
              Send Assessment
            </button>
            <button
              onClick={() => {
                setEditing(null)
                setOpenCreate(true)
              }}
              className="rounded-full bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(167,139,250,0.35)] transition hover:bg-violet-500"
            >
              Create Assessment
            </button>
          </div>
        </div>

        <AssessmentFlowGuide className="mt-6" />

        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatus(tab.value)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                status === tab.value
                  ? "border-violet-400/60 bg-violet-500/20 text-white"
                  : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-800 bg-slate-900/40">
          <div className="hv-table-scroll">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-950/20 text-slate-400">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Title</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Job</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Duration</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Passing %</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Created</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-slate-400">Loading assessments...</td>
                  </tr>
                ) : assessments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-slate-400">No assessments yet. Create one to get started.</td>
                  </tr>
                ) : (
                  assessments.map((assessment) => (
                    <tr key={assessment.id} className="border-t border-slate-800/80 text-slate-200">
                      <td className="px-4 py-3">
                        <Link
                          href={buildAuthUrl(`/assessments/${assessment.id}/questions`, searchParams)}
                          className="font-medium text-white underline-offset-4 hover:text-violet-200 hover:underline"
                        >
                          {assessment.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{assessment.jobTitle ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${statusTone(assessment.status)}`}>
                          {formatLabel(assessment.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{assessment.durationMinutes} min</td>
                      <td className="px-4 py-3 text-slate-300">{Number(assessment.passingPercentage)}%</td>
                      <td className="px-4 py-3 text-slate-400">{formatDate(assessment.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={buildAuthUrl(`/assessments/${assessment.id}/questions`, searchParams)}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 transition hover:text-white"
                          >
                            Questions
                          </Link>
                          <Link
                            href={buildAuthUrl(`/assessments/${assessment.id}/results`, searchParams)}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 transition hover:text-white"
                          >
                            Results
                          </Link>
                          <button
                            onClick={() => {
                              setEditing(assessment)
                              setOpenCreate(true)
                            }}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 transition hover:text-white"
                          >
                            Edit
                          </button>
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

      <CreateAssessmentModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        initialAssessment={editing}
        onSuccess={loadAssessments}
      />
      <SendAssessmentModal isOpen={openSend} onClose={() => setOpenSend(false)} />
    </div>
  )
}
