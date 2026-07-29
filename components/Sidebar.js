"use client"

import { useEffect, useMemo, useState } from "react"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { canAccessFeature } from "@/lib/client/permissions"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import CreateJobModal from "./CreateJobModal"
import HiringWorkflow from "./HiringWorkflow"
import SendInterviewModal from "./SendInterviewModal"

const DASHBOARD_INVALIDATED_EVENT = "hireveri:dashboard-data-invalidated"

export default function Sidebar({ initialProfile = null, overview = null }) {
  const searchParams = useAuthSearchParams()
  const [user, setUser] = useState(initialProfile)
  const [workflowOverview, setWorkflowOverview] = useState(overview)
  const [profileError, setProfileError] = useState("")
  const [openCreateJob, setOpenCreateJob] = useState(false)
  const [openSendInterview, setOpenSendInterview] = useState(false)

  useEffect(() => {
    if (overview) {
      queueMicrotask(() => setWorkflowOverview(overview))
    }
  }, [overview])

  useEffect(() => {
    if (overview) {
      return
    }

    let isMounted = true

    fetch(buildAuthUrl(`/api/dashboard/workflow?refresh=${Date.now()}`, searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((payload) => {
        if (!isMounted || !payload?.success) {
          return
        }

        setWorkflowOverview((current) => ({
          ...(current ?? {}),
          ...payload.data,
        }))
      })
      .catch((error) => {
        console.warn("Fast dashboard workflow refresh failed", error)
      })

    return () => {
      isMounted = false
    }
  }, [overview, searchParams])

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined
    }

    let refreshTimer = null

    async function refreshWorkflow() {
      try {
        const response = await fetch(buildAuthUrl(`/api/dashboard/workflow?refresh=${Date.now()}`, searchParams), {
          credentials: "include",
          cache: "no-store",
        })
        const payload = await response.json().catch(() => null)

        if (!response.ok || !payload?.success) {
          return
        }

        setWorkflowOverview((current) => ({
          ...(current ?? {}),
          ...payload.data,
        }))
      } catch (error) {
        console.warn("Realtime dashboard workflow refresh failed", error)
      }
    }

    function handleDashboardInvalidated() {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(refreshWorkflow, 150)
    }

    window.addEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      window.removeEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)
    }
  }, [searchParams])

  useEffect(() => {
    let isMounted = true

    function handleOpenCreateJobEvent() {
      setOpenCreateJob(true)
    }

    function handleOpenSendInterviewEvent() {
      setOpenSendInterview(true)
    }

    if (!initialProfile) {
      fetch(buildAuthUrl("/api/me", searchParams), {
        credentials: "include",
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((data) => {
          if (!isMounted) {
            return
          }

          if (data.success) {
            setUser(data.data)
            setProfileError("")
            return
          }

          setUser(data.data ?? null)
          setProfileError(data.error?.message || data.message || "Recruiter profile could not be loaded")
        })
        .catch((error) => {
          console.error("Failed to fetch recruiter profile", error)
          if (isMounted) {
            setProfileError("Recruiter profile could not be loaded")
          }
        })
    }

    window.addEventListener("hireveri:open-create-job", handleOpenCreateJobEvent)
    window.addEventListener("hireveri:open-send-interview", handleOpenSendInterviewEvent)

    return () => {
      isMounted = false
      window.removeEventListener("hireveri:open-create-job", handleOpenCreateJobEvent)
      window.removeEventListener("hireveri:open-send-interview", handleOpenSendInterviewEvent)
    }
  }, [initialProfile, searchParams])

  const displayUser = initialProfile ?? user
  const displayProfileError = initialProfile ? "" : profileError
  const canCreateJob = canAccessFeature(displayUser, "createJob")
  const canSendInterview = canAccessFeature(displayUser, "sendInterview")

  const initials = useMemo(
    () =>
      displayUser?.name
        ?.split(" ")
        .map((part) => part[0])
        .join("") || "..",
    [displayUser]
  )

  const handleAction = (id) => {
    if (id === "create-job") {
      if (canCreateJob) {
        setOpenCreateJob(true)
      }
      return
    }

    if (id === "send-link") {
      if (canSendInterview) {
        setOpenSendInterview(true)
      }
      return
    }

    if (id === "skip-screening") {
      if (canSendInterview) {
        setOpenSendInterview(true)
      }
    }
  }

  return (
    <>
      <aside className="hv-elevated-section mt-10 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-[0_14px_44px_rgba(2,6,23,0.18)] xl:p-3.5 2xl:p-4">
        <h2 className="text-[1.9rem] font-semibold leading-none text-white xl:text-[1.7rem]">Recruiter</h2>

        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/30 p-4 xl:p-3 2xl:p-3.5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-500/15 text-xl font-semibold text-blue-300 xl:h-12 xl:w-12 xl:text-lg">
            {initials}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[1.1rem] font-semibold leading-tight text-white xl:text-base">
              {displayUser?.name || "Loading..."}
            </div>
            <div className="truncate text-sm text-slate-400 xl:text-[13px]">{displayUser?.organization || ""}</div>
          </div>
        </div>

        {displayProfileError ? (
          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {displayProfileError}
          </div>
        ) : null}

        <HiringWorkflow overview={workflowOverview} profile={displayUser} onAction={handleAction} />
      </aside>

      {canCreateJob ? <CreateJobModal open={openCreateJob} setOpen={setOpenCreateJob} /> : null}
      {canSendInterview ? <SendInterviewModal isOpen={openSendInterview} onClose={() => setOpenSendInterview(false)} /> : null}
    </>
  )
}
