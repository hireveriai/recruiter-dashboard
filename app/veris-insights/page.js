"use client"

import { useEffect, useMemo, useState } from "react"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import { VerisGlobeLoader } from "@/components/system/loaders"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

const PAGE_SIZE = 24

function getRecommendationColor(value) {
  const normalized = String(value ?? "").toUpperCase()

  if (normalized === "STRONG HIRE" || normalized === "HIRE") {
    return "text-green-400"
  }

  if (normalized === "HOLD" || normalized === "REVIEW REQUIRED") {
    return "text-yellow-400"
  }

  return "text-red-400"
}

function getRiskColor(value) {
  const normalized = String(value ?? "").toUpperCase()

  if (normalized === "LOW") {
    return "text-green-400"
  }

  if (normalized === "MEDIUM") {
    return "text-yellow-400"
  }

  return "text-red-400"
}

function getInsightSummary(item) {
  const reason = String(item.recommendationReason ?? "").trim()
  const behavioralFlags = String(item.behavioralFlagsShort ?? "").trim()
  const strengths = String(item.strengthsShort ?? "").trim()

  if (reason) return reason
  if (behavioralFlags && !/^none$/i.test(behavioralFlags)) return behavioralFlags
  if (strengths) return strengths

  return "Review evidence and pipeline signals before final decision."
}

export default function VerisInsightsPage() {
  const searchParams = useAuthSearchParams()
  const cacheKey = `veris-insights:${searchParams.toString()}`
  const initialSummaries = readSessionJsonCache(cacheKey)
  const [summaries, setSummaries] = useState(() => initialSummaries?.summaries ?? [])
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [isLoading, setIsLoading] = useState(() => !initialSummaries)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(() => Boolean(initialSummaries?.hasMore))
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    const cached = readSessionJsonCache(cacheKey)

    if (cached) {
      window.queueMicrotask(() => {
        if (!active) {
          return
        }

        setSummaries(cached.summaries ?? [])
        setHasMore(Boolean(cached.hasMore))
        setIsLoading(false)
      })
    }

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        active = false
      }
    }

    async function loadSummaries(offset = 0) {
      try {
        if (offset === 0) {
          if (!cached) {
            setIsLoading(true)
          }
        } else {
          setIsLoadingMore(true)
        }
        setError("")

        const response = await fetch(buildAuthUrl(`/api/dashboard/veris?limit=${PAGE_SIZE + 1}&offset=${offset}`, searchParams), {
          credentials: "include",
          cache: "default",
        })
        const payload = await response.json()

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error?.message || payload?.message || "Unable to load VERIS insights")
        }

        if (active) {
          const nextSummaries = Array.isArray(payload.data) ? payload.data : []
          setHasMore(nextSummaries.length > PAGE_SIZE)
          setSummaries((current) => {
            const nextVisibleSummaries = offset === 0 ? nextSummaries.slice(0, PAGE_SIZE) : [...current, ...nextSummaries.slice(0, PAGE_SIZE)]
            if (offset === 0) {
              writeSessionJsonCache(cacheKey, {
                summaries: nextVisibleSummaries,
                hasMore: nextSummaries.length > PAGE_SIZE,
              })
            }
            return nextVisibleSummaries
          })
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load VERIS insights")
        }
      } finally {
        if (active) {
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    }

    loadSummaries()

    return () => {
      active = false
    }
  }, [cacheKey, searchParams])

  async function loadMoreSummaries() {
    try {
      setIsLoadingMore(true)
      setError("")

      const response = await fetch(buildAuthUrl(`/api/dashboard/veris?limit=${PAGE_SIZE + 1}&offset=${summaries.length}`, searchParams), {
        credentials: "include",
        cache: "default",
      })
      const payload = await response.json()

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message || payload?.message || "Unable to load more VERIS insights")
      }

      const nextSummaries = Array.isArray(payload.data) ? payload.data : []
      setHasMore(nextSummaries.length > PAGE_SIZE)
      setSummaries((current) => {
        const nextVisibleSummaries = [...current, ...nextSummaries.slice(0, PAGE_SIZE)]
        writeSessionJsonCache(cacheKey, {
          summaries: nextVisibleSummaries,
          hasMore: nextSummaries.length > PAGE_SIZE,
        })
        return nextVisibleSummaries
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load more VERIS insights")
    } finally {
      setIsLoadingMore(false)
    }
  }

  const counts = useMemo(() => {
    return summaries.reduce(
      (acc, item) => {
        const recommendation = String(item.recommendation ?? "").toUpperCase()
        const risk = String(item.riskLevel ?? "").toUpperCase()

        if (recommendation === "HIRE" || recommendation === "STRONG HIRE") acc.recommended += 1
        if (recommendation === "HOLD" || recommendation === "REVIEW REQUIRED") acc.review += 1
        if (risk === "HIGH") acc.highRisk += 1

        return acc
      },
      { total: summaries.length, recommended: 0, review: 0, highRisk: 0 }
    )
  }, [summaries])

  function toggleDetails(attemptId) {
    setExpandedIds((current) => {
      const next = new Set(current)

      if (next.has(attemptId)) {
        next.delete(attemptId)
      } else {
        next.add(attemptId)
      }

      return next
    })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#08111f] text-white">
        <Navbar />
        <VerisGlobeLoader
          eyebrow="VERIS Insights"
          viewportOffset="navbar"
          steps={[
            { label: "Loading insights", detail: "Fetching candidate intelligence summaries and evidence signals." },
            { label: "Reading risk", detail: "Preparing recommendation, score, and risk posture details." },
            { label: "Organizing review", detail: "Building the evidence grid for recruiter review." },
            { label: "Insights ready", detail: "VERIS insights are ready for decision review." },
          ]}
          activeIndex={1}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#08111f] text-white">
      <Navbar />
      <main className="px-6 py-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">Evidence Review</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">VERIS Insights</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Full candidate intelligence summaries with recommendation, risk posture, and review evidence.
            </p>
          </div>
          <BackToDashboardLink
            label="Back to Dashboard"
            className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-400/40 hover:text-white"
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-5 text-sm text-amber-100">
            {error}
          </div>
        ) : (
          <>
            <div className="mb-5 grid gap-3 md:grid-cols-4">
              {[
                ["Loaded Summaries", counts.total],
                ["Recommended", counts.recommended],
                ["Review Queue", counts.review],
                ["High Risk", counts.highRisk],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-800 bg-[#111a2e] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>

            {summaries.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#111a2e] p-6 text-center text-slate-400">
                No VERIS insights available yet.
              </div>
            ) : (
              <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {summaries.map((item) => {
                  const isExpanded = expandedIds.has(item.attemptId)

                  return (
                    <article key={item.attemptId} className="rounded-lg border border-slate-800 bg-[#111a2e] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-semibold text-white">{item.candidateName}</h2>
                          <p className="mt-0.5 truncate text-sm text-slate-400">{item.jobTitle}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Risk Level</p>
                          <p className={`mt-1 text-sm font-semibold ${getRiskColor(item.riskLevel)}`}>{item.riskLevel}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-slate-400">Recommendation</span>
                        <span className={`font-semibold ${getRecommendationColor(item.recommendation)}`}>{item.recommendation}</span>
                        <span className="text-slate-700">/</span>
                        <span className="text-slate-400">Score</span>
                        <span className="font-semibold text-blue-300">{item.scoreLabel ?? "-"}</span>
                      </div>

                      <p className="mt-2 text-sm leading-6 text-slate-300">{getInsightSummary(item)}</p>

                      <button
                        type="button"
                        onClick={() => toggleDetails(item.attemptId)}
                        className="mt-3 text-xs font-semibold text-cyan-200 transition hover:text-cyan-100"
                      >
                        {isExpanded ? "Hide evidence details" : "View evidence details"}
                      </button>

                      {isExpanded ? (
                        <div className="mt-3 grid gap-2 rounded-lg border border-slate-800 bg-slate-950/25 p-3 text-sm text-slate-300">
                          <div>
                            Strengths: <span className="text-slate-100">{item.strengthsShort || "-"}</span>
                          </div>
                          <div>
                            Weaknesses: <span className="text-slate-100">{item.weaknessesShort || "-"}</span>
                          </div>
                          <div>
                            Behavioral Flags: <span className="text-slate-100">{item.behavioralFlagsShort || "-"}</span>
                          </div>
                          <div>
                            Decision Rationale: <span className="text-slate-100">{item.recommendationReason || "-"}</span>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
              {hasMore ? (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMoreSummaries}
                    disabled={isLoadingMore}
                    className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoadingMore ? "Loading more insights..." : "Load more insights"}
                  </button>
                </div>
              ) : null}
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
