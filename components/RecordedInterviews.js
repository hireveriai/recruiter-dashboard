"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl, hasAuthQuery } from "@/lib/client/auth-query"
import { canAccessFeature } from "@/lib/client/permissions"
import { openWarRoom } from "@/lib/client/war-room"
import { CardSkeleton } from "@/components/system/skeletons"
import RecordedInterviewCard from "@/components/interviews/RecordedInterviewCard"

const DASHBOARD_INVALIDATED_EVENT = "hireveri:dashboard-data-invalidated"

function getInterviewActivityTime(interview) {
  const value = interview?.endedAt || interview?.startedAt || interview?.startTime || interview?.createdAt
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function RecordedInterviewsModal({ isOpen, onClose, interviews, organizationId, profile }) {
  const canOpenWarRoom = canAccessFeature(profile, "warRoom")

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#020817]/80 px-4 py-4 backdrop-blur-md sm:py-6" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/95 shadow-[0_18px_60px_rgba(2,6,23,0.28)]">
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-300/70 to-transparent" />

        <div className="flex items-center justify-between border-b border-white/10 px-8 py-6">
          <div>
            <h3 className="text-2xl font-semibold text-white">Interview Evidence Archive</h3>
            <p className="mt-2 text-sm text-slate-400">
              Interview replay evidence, audit trail, and behavioral review entry points.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-2 text-sm text-fuchsia-100 transition hover:bg-fuchsia-400/20"
          >
            Close
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto px-8 py-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {interviews.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-slate-400 lg:col-span-2">
                No interview recordings available
              </div>
            ) : (
              interviews.map((item) => (
                <RecordedInterviewCard
                  key={item.recordingId}
                  item={item}
                  compact
                  canOpenWarRoom={canOpenWarRoom}
                  onOpenWarRoom={() => openWarRoom(organizationId)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RecordedInterviews({ initialRecordedInterviews, organizationId = "", profile = null, isLoading = false }) {
  const searchParams = useAuthSearchParams()
  const [interviews, setInterviews] = useState(() => initialRecordedInterviews ?? [])
  const [isFetching, setIsFetching] = useState(initialRecordedInterviews === undefined)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const displayInterviews = interviews
  const isBusy = isLoading || isFetching
  const canOpenWarRoom = canAccessFeature(profile, "warRoom")

  useEffect(() => {
    if (initialRecordedInterviews !== undefined) {
      queueMicrotask(() => {
        setInterviews(initialRecordedInterviews ?? [])
        setIsFetching(false)
      })
      return
    }

    if (!hasAuthQuery(searchParams)) {
      queueMicrotask(() => setIsFetching(false))
      return
    }

    let isMounted = true
    let cancelScheduled = () => {}
    let loaderCeilingTimer = null

    if (initialRecordedInterviews === undefined) {
      queueMicrotask(() => setIsFetching(true))
      loaderCeilingTimer = window.setTimeout(() => {
        if (isMounted) {
          setIsFetching(false)
        }
      }, 1200)
    }

    const fetchRecordings = () => {
      fetch(buildAuthUrl("/api/dashboard/recordings?limit=6", searchParams), {
        credentials: "include",
        cache: initialRecordedInterviews === undefined ? "default" : "no-store",
      })
        .then((res) => res.json())
        .then((data) => {
          if (isMounted && data.success) {
            setInterviews(data.data ?? [])
          }
        })
        .catch((error) => {
          console.error("Failed to fetch recorded interviews", error)
        })
        .finally(() => {
          if (loaderCeilingTimer) {
            window.clearTimeout(loaderCeilingTimer)
          }
          if (isMounted) {
            setIsFetching(false)
          }
        })
    }

    if (typeof window !== "undefined") {
      const timeoutId = window.setTimeout(fetchRecordings, 120)
      cancelScheduled = () => window.clearTimeout(timeoutId)
    } else {
      fetchRecordings()
    }

    return () => {
      isMounted = false
      if (loaderCeilingTimer) {
        window.clearTimeout(loaderCeilingTimer)
      }
      cancelScheduled()
    }
  }, [initialRecordedInterviews, searchParams])

  useEffect(() => {
    if (!hasAuthQuery(searchParams) || typeof window === "undefined") {
      return undefined
    }

    let refreshTimer = null

    function refreshRecordings() {
      fetch(buildAuthUrl("/api/dashboard/recordings?limit=6", searchParams), {
        credentials: "include",
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setInterviews(data.data ?? [])
          }
        })
        .catch((error) => {
          console.error("Failed to refresh recorded interviews", error)
        })
    }

    function handleDashboardInvalidated() {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(refreshRecordings, 200)
    }

    window.addEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      window.removeEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)
    }
  }, [searchParams])

  const sortedInterviews = useMemo(
    () =>
      [...displayInterviews].sort(
        (a, b) => getInterviewActivityTime(b) - getInterviewActivityTime(a)
      ),
    [displayInterviews]
  )

  const previewInterviews = sortedInterviews.slice(0, 2)

  return (
    <>
      <div className="mt-10">
        <div className="flex justify-between items-center mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/70">Evidence Review</p>
            <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-white">
              Recorded Interviews
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                Recent
              </span>
            </h2>
          </div>

          {sortedInterviews.length > previewInterviews.length ? (
            <button
              type="button"
              className="text-blue-400 text-sm"
              onClick={() => setIsModalOpen(true)}
            >
              View All
            </button>
          ) : null}
        </div>

        {isBusy ? (
          <CardSkeleton count={2} className="grid-cols-1 lg:grid-cols-2" />
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {previewInterviews.length === 0 ? (
            <div className="rounded-[24px] border border-slate-800 bg-[#111a2e] p-5 text-center text-gray-400 shadow-md lg:col-span-2">
              No interview recordings available
            </div>
          ) : (
            previewInterviews.map((item) => (
              <RecordedInterviewCard
                key={item.recordingId}
                item={item}
                organizationId={organizationId}
                canOpenWarRoom={canOpenWarRoom}
                onOpenWarRoom={() => openWarRoom(organizationId)}
              />
            ))
          )}
          </div>
        )}
      </div>

      <RecordedInterviewsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        interviews={sortedInterviews}
        organizationId={organizationId}
        profile={profile}
      />
    </>
  )
}




