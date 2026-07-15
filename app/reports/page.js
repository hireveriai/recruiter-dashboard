"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import SendInterviewModal from "@/components/SendInterviewModal"
import { VerisGlobeLoader } from "@/components/system/loaders"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDate, formatDateTime, formatTime } from "@/lib/client/date-format"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-"
  }

  return `${Number(value).toFixed(1)}%`
}

function formatMetric(value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return options.fallback ?? "-"
  }

  if (options.percent) {
    return `${Math.round(Number(value) * 100)}`
  }

  return String(value)
}

function getSeverityClass(severity) {
  if (severity === "critical") {
    return "border-rose-500/30 bg-rose-500/12 text-rose-100"
  }

  if (severity === "warning") {
    return "border-amber-500/30 bg-amber-500/12 text-amber-100"
  }

  return "border-cyan-500/30 bg-cyan-500/12 text-cyan-100"
}

function getRecommendationClass(recommendation) {
  const normalized = String(recommendation ?? "").toUpperCase()

  if (normalized === "STRONG HIRE" || normalized === "HIRE") {
    return "border-emerald-500/30 bg-emerald-500/12 text-emerald-200"
  }

  if (normalized === "HOLD" || normalized === "REVIEW REQUIRED") {
    return "border-amber-500/30 bg-amber-500/12 text-amber-200"
  }

  return "border-rose-500/30 bg-rose-500/12 text-rose-200"
}

function getStageAccent(stageKey) {
  const normalized = String(stageKey ?? "").toLowerCase()

  if (normalized.includes("started")) {
    return { color: "#38bdf8", text: "text-sky-200", glow: "rgba(56,189,248,0.28)" }
  }

  if (normalized.includes("completed")) {
    return { color: "#34d399", text: "text-emerald-200", glow: "rgba(52,211,153,0.26)" }
  }

  if (normalized.includes("flagged")) {
    return { color: "#fb7185", text: "text-rose-200", glow: "rgba(251,113,133,0.25)" }
  }

  if (normalized.includes("selected")) {
    return { color: "#a78bfa", text: "text-violet-200", glow: "rgba(167,139,250,0.26)" }
  }

  return { color: "#22d3ee", text: "text-cyan-200", glow: "rgba(34,211,238,0.28)" }
}

function StageConversionDonut({ stage }) {
  const conversion = Math.max(0, Math.min(100, Number(stage.conversionRate || 0)))
  const accent = getStageAccent(stage.key || stage.label)
  const degrees = conversion * 3.6
  const centerLabel = `${Math.round(conversion)}%`

  return (
    <div
      aria-label={`${stage.label} conversion ${formatPercent(conversion)}`}
      className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-slate-700/70"
      role="img"
      style={{
        background: `conic-gradient(${accent.color} 0deg ${degrees}deg, rgba(30,41,59,0.95) ${degrees}deg 360deg)`,
        boxShadow: `0 0 26px ${accent.glow}, inset 0 0 20px rgba(2,6,23,0.72)`,
      }}
    >
      <div className="absolute inset-2.5 rounded-full border border-slate-800 bg-slate-950" />
      <div className="absolute inset-5 rounded-full border border-slate-800/80 bg-[#08111f]" />
      <div className="relative text-center">
        <p className="text-lg font-semibold text-white">{centerLabel}</p>
        <p className={`mt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${accent.text}`}>Conv.</p>
      </div>
    </div>
  )
}

function ExpandableSection({ title, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 border-b border-slate-800 px-6 py-5 text-left"
      >
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-300">
          {open ? "Collapse" : "Expand"}
        </span>
      </button>

      {open ? <div className="px-6 py-6">{children}</div> : null}
    </section>
  )
}

export default function ReportsPage() {
  const searchParams = useAuthSearchParams()
  const cacheKey = `reports:${searchParams.toString()}`
  const initialReport = readSessionJsonCache(cacheKey)
  const [report, setReport] = useState(() => initialReport ?? null)
  const [loading, setLoading] = useState(() => !initialReport)
  const [error, setError] = useState("")
  const [openSendInterview, setOpenSendInterview] = useState(false)

  useEffect(() => {
    let active = true
    const cached = readSessionJsonCache(cacheKey)

    if (cached) {
      window.queueMicrotask(() => {
        if (active) {
          setReport(cached)
          setLoading(false)
        }
      })
    }

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        active = false
      }
    }

    fetch(buildAuthUrl("/api/reports/overview", searchParams), {
      credentials: "include",
      cache: "default",
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!active) {
          return
        }

        if (!response.ok || !data?.success) {
          throw new Error(data?.error?.message || data?.message || "Unable to load reports")
        }

        setError("")
        setReport(data.data ?? null)
        writeSessionJsonCache(cacheKey, data.data ?? null)
      })
      .catch((fetchError) => {
        if (!active) {
          return
        }

        setError(fetchError instanceof Error ? fetchError.message : "Unable to load reports")
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [cacheKey, searchParams])

  const generatedDate = useMemo(() => {
    return report?.generatedAt ? formatDate(report.generatedAt).toUpperCase() : "-"
  }, [report])
  const generatedTime = useMemo(() => {
    return report?.generatedAt ? formatTime(report.generatedAt).replace(/\s+IN\s+([A-Z]{2,5})$/i, " $1") : "-"
  }, [report])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />
        <VerisGlobeLoader
          eyebrow="Reports"
          viewportOffset="navbar"
          steps={[
            { label: "Loading reports", detail: "Fetching hiring analytics and forensic signals." },
            { label: "Reading metrics", detail: "Preparing funnel and risk data." },
            { label: "Building report", detail: "Assembling executive insight sections." },
            { label: "Reports ready", detail: "Recruiter analytics are ready for review." },
          ]}
          activeIndex={1}
        />
      </div>
    )
  }

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />

      <main className="mx-auto max-w-[1680px] px-4 py-7 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[34px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.15),transparent_25%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_22%),linear-gradient(180deg,rgba(12,20,36,0.96),rgba(8,17,31,0.98))] px-8 py-8 shadow-[0_24px_100px_rgba(2,6,23,0.45)]">
          <div className="absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(520px,0.68fr)] xl:items-center 2xl:grid-cols-[minmax(0,1fr)_minmax(620px,0.68fr)]">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300/75">HireVeri Reports</p>
              <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-white lg:text-[40px] 2xl:text-[42px]">
                Hiring Decisions & Risk Intelligence
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">
                Real-time evaluation of candidate performance, behavioral signals, and integrity risk.
              </p>
            </div>

            <div className="grid min-w-0 auto-rows-fr gap-3 sm:grid-cols-2">
              <div className="flex min-h-[136px] min-w-0 flex-col justify-center rounded-xl border border-slate-700 bg-slate-950/35 p-4 shadow-sm">
                <p className="text-sm text-slate-500">Generated</p>
                <div className="mt-3 min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{generatedDate}</p>
                  <p className="mt-1 truncate text-xl font-semibold tracking-normal text-cyan-50 sm:text-2xl">{generatedTime}</p>
                </div>
              </div>
              <div className="flex min-h-[136px] min-w-0 flex-col justify-center rounded-xl border border-slate-700 bg-slate-950/35 p-4 shadow-sm">
                <p className="text-sm text-slate-500">Module State</p>
                <p className="mt-3 truncate text-xl font-semibold text-cyan-200 sm:text-2xl">Live Aggregation</p>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-400">
            Enterprise reporting focused on forensic hiring signals and recruiter traceability.
          </p>
          <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <div className="mt-6">
          {!loading && error ? (
            <div className="rounded-[28px] border border-rose-500/20 bg-rose-500/10 p-6 text-rose-100">
              {error}
            </div>
          ) : null}

          {!loading && !error && report ? (
            <div className="grid gap-6">
              <ExpandableSection
                title="Executive Summary"
                subtitle="Top-line metrics for recruiter leadership, audit readiness, and hiring performance."
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {report.executiveSummary.cards.map((card) => (
                    <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
                      <p className="text-sm text-slate-500">{card.label}</p>
                      <p className="mt-3 text-3xl font-semibold text-white">{card.value}</p>
                      <p className="mt-3 text-sm leading-6 text-slate-400">{card.helper}</p>
                    </div>
                  ))}
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-5 xl:col-span-1">
                    <p className="text-sm text-cyan-100/70">Drop-off Rate</p>
                    <p className="mt-3 text-3xl font-semibold text-white">{formatPercent(report.executiveSummary.dropOffRate)}</p>
                    <p className="mt-3 text-sm leading-6 text-cyan-50/75">
                      Invite-to-start fallout across the current recruiter organization.
                    </p>
                  </div>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Interview Funnel"
                subtitle="Invited to selected conversion flow with stage-level drop-off visibility."
              >
                <div className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]">
                  <div className="grid gap-4">
                    {report.interviewFunnel.stages.map((stage) => (
                      <div key={stage.key} className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-white">{stage.label}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">Stage Count</p>
                            <p className="mt-3 text-3xl font-semibold text-white">{stage.count}</p>
                            <p className="mt-2 text-xs text-slate-400">Drop-off at this stage: {formatPercent(stage.dropOffRate)}</p>
                          </div>
                          <StageConversionDonut stage={stage} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
                    <p className="text-sm font-medium text-white">Drop-off Analytics</p>
                    <div className="mt-5 space-y-4">
                      {report.interviewFunnel.stages.slice(0, 4).map((stage) => (
                        <div key={`${stage.key}-analytics`} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm text-slate-300">{stage.label}</span>
                            <span className="text-sm font-medium text-white">{formatPercent(stage.dropOffRate)}</span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-500">
                            {stage.dropOffRate >= 40
                              ? "High decay signal. This stage likely needs tighter scheduling or candidate comms."
                              : "Healthy movement relative to the current funnel volume."}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Cognitive Risk Report"
                subtitle="A compact readout of confidence, stress, clarity, suspicion, and behavioral anomaly load."
              >
                <div className="grid gap-4 lg:grid-cols-5">
                  {[
                    ["Confidence", report.cognitiveRisk.confidenceScore, "text-cyan-200", true, "-"],
                    ["Stress (coming soon)", report.cognitiveRisk.stressIndex, "text-amber-200", false, "Partial"],
                    ["Clarity", report.cognitiveRisk.clarityIndex, "text-emerald-200", true, "-"],
                    ["Suspicion", report.cognitiveRisk.suspicionIndex, "text-rose-200", false, "-"],
                    ["Anomalies", report.cognitiveRisk.behavioralAnomalies, "text-violet-200", false, "0"],
                  ].map(([label, value, tone, percent, fallback]) => (
                    <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
                      <p className="text-sm text-slate-500">{label}</p>
                      <p className={`mt-3 text-3xl font-semibold ${tone}`}>
                        {formatMetric(value, { percent, fallback })}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
                  <p className="text-sm font-medium text-white">Narrative</p>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{report.cognitiveRisk.narrative}</p>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Interview Timeline"
                subtitle="Timestamped recruiter and system events, ready for recording deep-linking when recording feeds are attached."
              >
                <div className="space-y-4">
                  {report.interviewTimeline.map((item) => (
                    <div key={item.id} className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-4 lg:grid-cols-[200px_1fr_auto] lg:items-center">
                      <div className="whitespace-nowrap text-sm text-slate-400">{formatDateTime(item.at)}</div>
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm font-medium text-white">{item.title}</p>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${getSeverityClass(item.severity)}`}>
                            {item.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                      </div>
                      {item.recordingUrl ? (
                        <a
                          href={item.recordingUrl}
                          className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/20"
                        >
                          Jump to Recording
                        </a>
                      ) : (
                        <span className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-500">
                          No Recording
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Integrity Review"
                subtitle="Forensic visibility across suspicious patterns and signal-feed readiness."
              >
                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className="grid gap-4 md:grid-cols-2">
                    {report.fraudDetection.cards.map((card) => (
                      <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
                        <p className="text-sm text-slate-500">{card.label}</p>
                        <p className="mt-3 text-3xl font-semibold text-white">{card.value}</p>
                        <p className="mt-3 text-sm leading-6 text-slate-400">{card.helper}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
                    <p className="text-sm font-medium text-white">Suspicious Pattern Brief</p>
                    <div className="mt-4 space-y-3">
                      {report.fraudDetection.suspiciousPatterns.length > 0 ? report.fraudDetection.suspiciousPatterns.map((pattern) => (
                        <div key={pattern} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm leading-6 text-slate-300">
                          {pattern}
                        </div>
                      )) : (
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm leading-6 text-slate-400">
                          No suspicious calm-room patterns detected in the current reporting window.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Candidate Ranking"
                subtitle="Score-weighted ordering with recommendation and current risk posture."
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="text-slate-400">
                      <tr className="border-b border-slate-800">
                        <th className="px-4 py-4 text-left font-medium">Rank</th>
                        <th className="px-4 py-4 text-left font-medium">Candidate</th>
                        <th className="px-4 py-4 text-left font-medium">Role</th>
                        <th className="px-4 py-4 text-left font-medium">Score</th>
                        <th className="px-4 py-4 text-left font-medium">Recommendation</th>
                        <th className="px-4 py-4 text-left font-medium">Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.candidateRanking.map((candidate) => (
                        <tr key={candidate.attemptId} className="border-b border-slate-800/70 text-slate-200">
                          <td className="px-4 py-4 font-semibold text-white">{candidate.rank}</td>
                          <td className="px-4 py-4">{candidate.candidateName}</td>
                          <td className="px-4 py-4 text-slate-400">{candidate.jobTitle}</td>
                          <td className="px-4 py-4 text-cyan-200">{candidate.score} / 100</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getRecommendationClass(candidate.recommendation)}`}>
                              {candidate.recommendation}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-slate-300">{candidate.riskLevel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Role Insights"
                subtitle="Performance distribution, failure trends, and recurring skill gaps per job."
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead className="text-slate-400">
                      <tr className="border-b border-slate-800">
                        <th className="px-4 py-4 text-left font-medium">Role</th>
                        <th className="px-4 py-4 text-left font-medium">Avg Score</th>
                        <th className="px-4 py-4 text-left font-medium">Completed</th>
                        <th className="px-4 py-4 text-left font-medium">Flagged</th>
                        <th className="px-4 py-4 text-left font-medium">Selected</th>
                        <th className="px-4 py-4 text-left font-medium">Failure Trend</th>
                        <th className="px-4 py-4 text-left font-medium">Skill Gap Analysis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.roleInsights.map((role) => (
                        <tr key={role.jobId} className="border-b border-slate-800/70 text-slate-200">
                          <td className="px-4 py-4 font-medium text-white">{role.jobTitle}</td>
                          <td className="px-4 py-4 text-cyan-200">{role.averageScore}</td>
                          <td className="px-4 py-4">{role.completedInterviews}</td>
                          <td className="px-4 py-4">{role.flaggedInterviews}</td>
                          <td className="px-4 py-4">{role.selectedCandidates}</td>
                          <td className="px-4 py-4 text-slate-300">{role.failureTrend}</td>
                          <td className="px-4 py-4 text-slate-400">
                            {role.skillGaps.length > 0 ? role.skillGaps.join(", ") : "No recurring low-signal gaps yet"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Audit Logs"
                subtitle="Recruiter, candidate, and system event trail for enterprise-grade traceability."
                defaultOpen={false}
              >
                <div className="space-y-3">
                  {report.auditLogs.map((item) => (
                    <div key={item.id} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/30 p-4 lg:grid-cols-[200px_170px_170px_1fr]">
                      <div className="whitespace-nowrap text-sm text-slate-400">{formatDateTime(item.at)}</div>
                      <div className="text-sm font-medium text-white">{item.actor}</div>
                      <div className="text-sm text-cyan-200">{item.action}</div>
                      <div>
                        <p className="text-sm text-white">{item.target}</p>
                        <p className="mt-1 text-sm text-slate-400">{item.source} · {item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ExpandableSection>
            </div>
          ) : null}
        </div>
      </main>

      <SendInterviewModal isOpen={openSendInterview} onClose={() => setOpenSendInterview(false)} />
    </div>
  )
}
