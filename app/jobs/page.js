"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"

import BackToDashboardLink from "../../components/BackToDashboardLink"
import FeatureLockedNotice from "@/components/FeatureLockedNotice"
import Navbar from "../../components/Navbar"
import SendInterviewModal from "../../components/SendInterviewModal"
import SendAssessmentModal from "../../components/SendAssessmentModal"
import CreateJobModal from "../../components/CreateJobModal"

function KebabIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function getDifficultyTone(profile) {
  const normalized = String(profile ?? "MID").toUpperCase()

  if (normalized === "SENIOR") {
    return "bg-slate-800 text-slate-100 border-slate-700"
  }

  if (normalized === "JUNIOR") {
    return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
  }

  return "bg-blue-500/10 text-blue-300 border-blue-500/20"
}

function InterviewModeCell({ mode, questionnaireStatus, versionNumber, hasDraft }) {
  const standard = String(mode ?? "INDIVIDUALIZED").toUpperCase() === "STANDARD"

  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={`inline-flex w-fit rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
          standard
            ? "border-violet-500/20 bg-violet-500/10 text-violet-200"
            : "border-slate-700 bg-slate-800/60 text-slate-300"
        }`}
        title={
          standard
            ? "Every candidate answers the same structured questionnaire"
            : "Each candidate gets their own structured questions"
        }
      >
        {standard ? "Standard" : "Individualized"}
      </span>

      {standard ? (
        <span className="text-[11px] text-slate-400">
          {questionnaireStatus === "FINALIZED" ? (
            <>
              Questionnaire v{versionNumber}
              {hasDraft ? (
                <span className="ml-1 text-amber-300">· draft pending</span>
              ) : null}
            </>
          ) : questionnaireStatus === "DRAFT" ? (
            <span className="text-amber-300">Draft not finalized</span>
          ) : (
            <span className="text-slate-500">Not generated yet</span>
          )}
        </span>
      ) : null}
    </div>
  )
}

const menuItem =
  "hv-interview-action-item flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"

function formatDifficulty(profile) {
  const value = String(profile ?? "MID").toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function roleInitials(title) {
  const words = String(title ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean)
  if (words.length === 0) return "J"
  return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : "")).toUpperCase()
}

function getStatusTone(isActive) {
  return isActive
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : "border-amber-500/20 bg-amber-500/10 text-amber-300"
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase()
}

// The jobs list only carries experienceLevelId, so the table and the filter
// used to render a bare "Level 3". Recruiters pick these by name when they
// create a job, so the list now resolves the same names, from the same
// endpoint the create form reads. FALLBACK_EXPERIENCE_LEVELS only covers the
// endpoint being unavailable.
const FALLBACK_EXPERIENCE_LEVELS = [
  { experience_level_id: 1, label: "Fresher / Student" },
  { experience_level_id: 2, label: "Junior" },
  { experience_level_id: 3, label: "Mid" },
  { experience_level_id: 4, label: "Senior" },
]

function uniqueSorted(values) {
  return Array.from(new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "")))
    .map(String)
    .sort((a, b) => a.localeCompare(b))
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.12em] text-slate-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-[13px] font-medium normal-case tracking-normal text-slate-200 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function JobDescriptionCell({ description }) {
  const value = String(description || "").trim()
  const fallback = "No job description provided"
  const preview = value || fallback

  return (
    <div className="group relative max-w-full">
      <div className={`truncate leading-5 ${value ? "cursor-help text-slate-400" : "text-slate-600"}`}>
        {preview}
      </div>

      {value ? (
        <div className="hv-preserve-dark pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-[520px] max-w-[42vw] rounded-2xl border border-slate-700 bg-[#1f2937] px-4 py-3 text-sm leading-7 text-slate-100 shadow-[0_18px_48px_rgba(2,6,23,0.45)] group-hover:block">
          <div className="line-clamp-[20] whitespace-pre-wrap break-words">
            {value}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function JobSkillsCell({ skills }) {
  const items = Array.isArray(skills) ? skills.filter(Boolean) : []

  if (items.length === 0) {
    return <span className="text-xs text-slate-600">&ndash;</span>
  }

  const shown = items.slice(0, 3)
  const remaining = items.length - shown.length

  return (
    <div className="flex flex-wrap items-center gap-1" title={items.join(", ")}>
      {shown.map((skill) => (
        <span key={skill} className="max-w-full truncate rounded-md border border-slate-700 bg-slate-950/40 px-1.5 py-0.5 text-[11px] text-slate-300">
          {skill}
        </span>
      ))}
      {remaining > 0 ? (
        <span className="rounded-md px-1 py-0.5 text-[11px] font-semibold text-cyan-300">+{remaining}</span>
      ) : null}
    </div>
  )
}

export default function JobsPage() {
  const router = useRouter()
  const searchParams = useAuthSearchParams()
  const cacheKey = `jobs:${searchParams.toString()}`
  const [jobs, setJobs] = useState([])
  const [supportsJobActiveState, setSupportsJobActiveState] = useState(false)
  const [openSendInterview, setOpenSendInterview] = useState(false)
  const [openSendAssessment, setOpenSendAssessment] = useState(false)
  const [sendAssessmentJobId, setSendAssessmentJobId] = useState("")
  const [openEditJob, setOpenEditJob] = useState(false)
  const [openCreateJob, setOpenCreateJob] = useState(false)
  const [selectedJob, setSelectedJob] = useState(null)
  const [pendingJobId, setPendingJobId] = useState("")
  const [openActionMenuJobId, setOpenActionMenuJobId] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [difficultyFilter, setDifficultyFilter] = useState("ALL")
  const [experienceFilter, setExperienceFilter] = useState("ALL")
  const [activityFilter, setActivityFilter] = useState("ALL")
  const [experienceLevels, setExperienceLevels] = useState([])
  const [lockedFeature, setLockedFeature] = useState(null)
  // Phones only: the four filters fold away behind a toggle.
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadExperienceLevels() {
      try {
        const response = await fetch(buildAuthUrl("/api/experience-levels", searchParams), {
          credentials: "include",
        })
        const data = await response.json()

        if (!isMounted) {
          return
        }

        setExperienceLevels(Array.isArray(data) && data.length > 0 ? data : FALLBACK_EXPERIENCE_LEVELS)
      } catch (error) {
        console.error("Failed to load experience levels", error)

        if (isMounted) {
          setExperienceLevels(FALLBACK_EXPERIENCE_LEVELS)
        }
      }
    }

    loadExperienceLevels()

    return () => {
      isMounted = false
    }
  }, [searchParams])

  const experienceLevelLabels = useMemo(() => {
    const source = experienceLevels.length > 0 ? experienceLevels : FALLBACK_EXPERIENCE_LEVELS

    return new Map(source.map((level) => [String(level.experience_level_id), level.label]))
  }, [experienceLevels])

  // Falls back to the raw id rather than hiding the value: a level the
  // endpoint does not know about still tells the recruiter something.
  const getExperienceLabel = (value) => {
    const key = String(value ?? "").trim()

    if (!key) {
      return "-"
    }

    return experienceLevelLabels.get(key) ?? `Level ${key}`
  }

  useEffect(() => {
    let isMounted = true
    const cached = readSessionJsonCache(cacheKey)

    if (cached) {
      window.queueMicrotask(() => {
        if (isMounted) {
          setJobs(cached.jobs ?? [])
          setSupportsJobActiveState(Boolean(cached.supportsJobActiveState))
        }
      })
    }

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        isMounted = false
      }
    }

    async function loadJobs() {
      try {
        const response = await fetch(buildAuthUrl("/api/jobs?includeInactive=1", searchParams), {
          credentials: "include",
          cache: "default",
        })
        const data = await response.json()

        if (!isMounted) {
          return
        }

        if (data?.error?.code === "FEATURE_NOT_IN_PLAN") {
          setLockedFeature(data.error.entitlement || "AI_INTERVIEW")
          return
        }

        if (!data.success) {
          return
        }

        setJobs(data.jobs ?? [])
        setSupportsJobActiveState(Boolean(data.meta?.supportsJobActiveState))
        writeSessionJsonCache(cacheKey, {
          jobs: data.jobs ?? [],
          supportsJobActiveState: Boolean(data.meta?.supportsJobActiveState),
        })
      } catch (error) {
        console.error("Failed to fetch jobs page data", error)
      }
    }

    loadJobs()

    return () => {
      isMounted = false
    }
  }, [cacheKey, searchParams])

  useEffect(() => {
    function handlePointerDown(event) {
      // Table rows and phone cards both render a menu for a job, so the
      // check is by attribute rather than a single ref.
      if (!event.target.closest?.("[data-job-menu]")) {
        setOpenActionMenuJobId("")
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpenActionMenuJobId("")
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [])

  const stats = useMemo(() => {
    const total = jobs.length
    const totalInterviews = jobs.reduce((sum, job) => sum + (job._count?.interviews ?? 0), 0)
    const seniorRoles = jobs.filter((job) => String(job.difficultyProfile).toUpperCase() === "SENIOR").length
    const activeJobs = jobs.filter((job) => job.isActive !== false).length

    return { total, totalInterviews, seniorRoles, activeJobs }
  }, [jobs])

  const filterOptions = useMemo(() => {
    return {
      difficulties: uniqueSorted(jobs.map((job) => job.difficultyProfile ?? "MID")),
      experienceLevels: uniqueSorted(jobs.map((job) => job.experienceLevelId)),
    }
  }, [jobs])

  const filteredJobs = useMemo(() => {
    const query = normalizeSearch(searchTerm)

    return jobs.filter((job) => {
      const isActive = job.isActive !== false
      const difficulty = String(job.difficultyProfile ?? "MID").toUpperCase()
      const experience = String(job.experienceLevelId ?? "")
      const interviewCount = job._count?.interviews ?? 0
      const searchable = [
        job.jobTitle,
        job.jobDescription,
        difficulty,
        experience,
        // So "senior" or "fresher" finds the role, not just the id behind it.
        experienceLevelLabels.get(experience),
        ...(Array.isArray(job.coreSkills) ? job.coreSkills : []),
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ")

      const matchesSearch = !query || searchable.includes(query)
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && isActive) ||
        (statusFilter === "INACTIVE" && !isActive)
      const matchesDifficulty = difficultyFilter === "ALL" || difficulty === difficultyFilter
      const matchesExperience = experienceFilter === "ALL" || experience === experienceFilter
      const matchesActivity =
        activityFilter === "ALL" ||
        (activityFilter === "WITH_INTERVIEWS" && interviewCount > 0) ||
        (activityFilter === "NO_INTERVIEWS" && interviewCount === 0)

      return matchesSearch && matchesStatus && matchesDifficulty && matchesExperience && matchesActivity
    })
  }, [jobs, searchTerm, statusFilter, difficultyFilter, experienceFilter, activityFilter, experienceLevelLabels])

  const hasActiveFilters =
    searchTerm || statusFilter !== "ALL" || difficultyFilter !== "ALL" || experienceFilter !== "ALL" || activityFilter !== "ALL"

  function clearFilters() {
    setSearchTerm("")
    setStatusFilter("ALL")
    setDifficultyFilter("ALL")
    setExperienceFilter("ALL")
    setActivityFilter("ALL")
  }

  const handleEdit = (job) => {
    setOpenActionMenuJobId("")
    setSelectedJob(job)
    setOpenEditJob(true)
  }

  const handleToggleActive = async (job) => {
    const nextIsActive = !(job.isActive !== false)

    try {
      setPendingJobId(job.jobId)
      setOpenActionMenuJobId("")

      const response = await fetch(buildAuthUrl(`/api/jobs/${job.jobId}`, searchParams), {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_active: nextIsActive,
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Failed to update job status")
      }

      setJobs((currentJobs) => {
        const nextJobs = currentJobs.map((item) =>
          item.jobId === job.jobId
            ? {
                ...item,
                isActive: nextIsActive,
              }
            : item
        )
        writeSessionJsonCache(cacheKey, {
          jobs: nextJobs,
          supportsJobActiveState,
        })
        return nextJobs
      })
    } catch (error) {
      console.error("Failed to update job status", error)
      window.alert(error instanceof Error ? error.message : "Failed to update job status")
    } finally {
      setPendingJobId("")
    }
  }

  if (lockedFeature) {
    return <FeatureLockedNotice feature={lockedFeature} />
  }

  const activeFilterCount = [statusFilter, difficultyFilter, experienceFilter, activityFilter].filter((value) => value !== "ALL").length
  const emptyMessage = jobs.length === 0 ? "No jobs available" : filteredJobs.length === 0 ? "No jobs match the current filters" : null

  // Same actions for the table row and the phone card.
  const renderActions = (job, showToggleButton) => {
    const isActive = job.isActive !== false
    const pending = pendingJobId === job.jobId
    const toggleLabel = pending ? "Saving..." : isActive ? "Mark Inactive" : "Mark Active"
    const menuOpen = openActionMenuJobId === job.jobId

    return (
      <div className="flex items-center justify-end gap-2" data-job-menu={job.jobId}>
        {supportsJobActiveState && showToggleButton ? (
          <button
            type="button"
            onClick={() => handleToggleActive(job)}
            disabled={pending}
            className="hidden h-8 min-w-[104px] items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60 min-[1200px]:inline-flex"
          >
            {toggleLabel}
          </button>
        ) : null}

        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => setOpenActionMenuJobId((current) => (current === job.jobId ? "" : job.jobId))}
            className="hv-interview-actions-trigger inline-flex h-8 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/70 text-slate-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100"
            aria-label={`Open actions for ${job.jobTitle}`}
            aria-expanded={menuOpen}
          >
            <KebabIcon />
          </button>

          {menuOpen ? (
            <div className="hv-interview-actions-menu hv-theme-popover absolute right-0 top-[calc(100%+6px)] z-30 w-48 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-1.5 text-left shadow-[0_18px_48px_rgba(2,6,23,0.45)]">
              {supportsJobActiveState ? (
                <button
                  type="button"
                  onClick={() => handleToggleActive(job)}
                  disabled={pending}
                  className={`${menuItem} ${showToggleButton ? "min-[1200px]:hidden" : ""}`}
                >
                  {toggleLabel}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpenActionMenuJobId("")
                  router.push(buildAuthUrl(`/jobs/${job.jobId}/questionnaire`, searchParams))
                }}
                className={menuItem}
              >
                Interview questions
              </button>
              <button type="button" onClick={() => handleEdit(job)} className={menuItem}>
                Edit job
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenActionMenuJobId("")
                  setOpenSendInterview(true)
                }}
                className={menuItem}
              >
                Send interview link
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenActionMenuJobId("")
                  setSendAssessmentJobId(job.jobId)
                  setOpenSendAssessment(true)
                }}
                className={menuItem}
              >
                Send assessment
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const renderStatus = (job) => {
    const isActive = job.isActive !== false
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getStatusTone(isActive)}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden="true" />
        {isActive ? "Active" : "Inactive"}
      </span>
    )
  }

  const renderRoleMeta = (job) => (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-400">
      <span className={`inline-flex rounded-md border px-1.5 py-px text-[10.5px] font-semibold ${getDifficultyTone(job.difficultyProfile)}`}>
        {formatDifficulty(job.difficultyProfile)}
      </span>
      <span>Experience: {getExperienceLabel(job.experienceLevelId)}</span>
      <span className="text-slate-600" aria-hidden="true">&middot;</span>
      <span>{job.interviewDurationMinutes ?? 30} min</span>
    </p>
  )

  const renderRoleIcon = (job) => (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
        job.isActive !== false ? "bg-cyan-400/15 text-cyan-200" : "bg-slate-800 text-slate-400"
      }`}
    >
      {roleInitials(job.jobTitle)}
    </span>
  )

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <header className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Role Portfolio</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">All Jobs</h1>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Live role inventory for your hiring organization, including experience band, evaluation depth, and current interview activity.
            </p>
          </header>
          <div className="flex flex-wrap items-center gap-2">
            <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
            <button
              type="button"
              onClick={() => {
                setSelectedJob(null)
                setOpenCreateJob(true)
              }}
              className="hv-solid-action inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              <span aria-hidden="true" className="text-base leading-none">+</span>
              Create Job
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Total Jobs", stats.total, false],
            ["Active Jobs", stats.activeJobs, true],
            ["Active Interview Tracks", stats.totalInterviews, false],
            ["Senior Roles", stats.seniorRoles, false],
          ].map(([label, value, accent]) => (
            <div
              key={label}
              className={`hv-elevated-section rounded-xl border px-4 py-3.5 shadow-[0_14px_44px_rgba(2,6,23,0.18)] ${
                accent ? "border-cyan-300/25 bg-cyan-400/[0.06]" : "border-slate-800 bg-slate-900/80"
              }`}
            >
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent ? "text-cyan-100" : "text-white"}`}>{value}</p>
            </div>
          ))}
        </div>

        <section
          aria-label="Job Roles"
          className="hv-elevated-section rounded-xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)]"
        >
          <div className="border-b border-slate-800 px-4 py-4 lg:px-5">
            <h2 className="text-base font-semibold text-white">Created Job Roles</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Showing {filteredJobs.length} of {jobs.length} jobs created under the current recruiter organization.
            </p>
          </div>

          <div className="grid gap-x-3 gap-y-2.5 border-b border-slate-800 bg-slate-950/20 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(130px,0.7fr))_auto] lg:px-5">
            <label className="grid gap-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.12em] text-slate-500 sm:col-span-2 lg:col-span-1">
              Search
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search title, skills, description"
                className="h-10 min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-[13px] font-medium normal-case tracking-normal text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowFilters((current) => !current)}
              aria-expanded={showFilters}
              className="h-10 rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition hover:border-slate-500 sm:hidden"
            >
              {showFilters ? "Hide filters" : "Filters"}
              {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
            <div className={`${showFilters ? "grid" : "hidden"} gap-x-3 gap-y-2.5 sm:contents`}>
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "ALL", label: "All Statuses" },
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Inactive" },
                ]}
              />
              <FilterSelect
                label="Difficulty"
                value={difficultyFilter}
                onChange={setDifficultyFilter}
                options={[{ value: "ALL", label: "All Difficulties" }, ...filterOptions.difficulties.map((value) => ({ value: value.toUpperCase(), label: value }))]}
              />
              <FilterSelect
                label="Experience"
                value={experienceFilter}
                onChange={setExperienceFilter}
                options={[{ value: "ALL", label: "All Levels" }, ...filterOptions.experienceLevels.map((value) => ({ value, label: getExperienceLabel(value) }))]}
              />
              <FilterSelect
                label="Activity"
                value={activityFilter}
                onChange={setActivityFilter}
                options={[
                  { value: "ALL", label: "All Activity" },
                  { value: "WITH_INTERVIEWS", label: "With Interviews" },
                  { value: "NO_INTERVIEWS", label: "No Interviews" },
                ]}
              />
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="h-10 self-end rounded-xl border border-slate-700 px-4 text-[13px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Register from lg up: six columns; description, difficulty,
              experience and duration sit under the role title. */}
          <div className="relative hidden lg:block">
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-[10%]" />
                <col className="w-[15%]" />
                <col className="w-[18%]" />
                <col className="w-[8%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead className="sticky top-[77px] z-10 bg-slate-950 text-slate-500 shadow-[0_1px_0_var(--color-slate-800)]">
                <tr className="[&>th]:whitespace-nowrap [&>th]:py-2.5 [&>th]:text-[10.5px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.14em]">
                  <th className="pl-5 pr-3 text-left">Role</th>
                  <th className="px-3 text-left">Status</th>
                  <th className="px-3 text-left">Interview mode</th>
                  <th className="px-3 text-left">Core skills</th>
                  <th className="px-3 text-right">Interviews</th>
                  <th className="pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {emptyMessage ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-slate-400">{emptyMessage}</td>
                  </tr>
                ) : (
                  filteredJobs.map((job) => (
                    <tr key={job.jobId} className="border-t border-slate-800/80 align-middle text-slate-200 transition-colors first:border-t-0 hover:bg-slate-800/25">
                      <td className="py-3 pl-5 pr-3">
                        <div className="flex min-w-0 items-start gap-3">
                          {renderRoleIcon(job)}
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => handleEdit(job)}
                              title={`Edit ${job.jobTitle}`}
                              className="block max-w-full truncate rounded text-left text-sm font-semibold text-white underline-offset-4 transition hover:text-cyan-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                            >
                              {job.jobTitle}
                            </button>
                            {renderRoleMeta(job)}
                            <div className="mt-1 text-xs">
                              <JobDescriptionCell description={job.jobDescription} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">{renderStatus(job)}</td>
                      <td className="px-3 py-3">
                        <InterviewModeCell
                          mode={job.interviewMode}
                          questionnaireStatus={job.questionnaireStatus}
                          versionNumber={job.questionnaireVersionNumber}
                          hasDraft={job.questionnaireHasDraft}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <JobSkillsCell skills={job.coreSkills} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`text-base font-semibold tabular-nums ${(job._count?.interviews ?? 0) > 0 ? "text-white" : "text-slate-600"}`}>
                          {job._count?.interviews ?? 0}
                        </span>
                      </td>
                      <td className="py-3 pl-3 pr-5">{renderActions(job, true)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Cards below lg: the same fields, labelled inline. */}
          {emptyMessage ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400 lg:hidden">{emptyMessage}</p>
          ) : (
            <ul className="lg:hidden" aria-label="Jobs">
              {filteredJobs.map((job) => (
                <li key={job.jobId} className="border-t border-slate-800/80 px-4 py-4 first:border-t-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {renderRoleIcon(job)}
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => handleEdit(job)}
                          title={`Edit ${job.jobTitle}`}
                          className="block max-w-full truncate text-left text-sm font-semibold text-white"
                        >
                          {job.jobTitle}
                        </button>
                        {renderRoleMeta(job)}
                      </div>
                    </div>
                    {renderStatus(job)}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Interview mode</dt>
                      <dd className="mt-1">
                        <InterviewModeCell
                          mode={job.interviewMode}
                          questionnaireStatus={job.questionnaireStatus}
                          versionNumber={job.questionnaireVersionNumber}
                          hasDraft={job.questionnaireHasDraft}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Open interviews</dt>
                      <dd className="mt-1 text-sm font-semibold tabular-nums text-white">{job._count?.interviews ?? 0}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Core skills</dt>
                      <dd className="mt-1">
                        <JobSkillsCell skills={job.coreSkills} />
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex justify-end border-t border-slate-800/80 pt-3">{renderActions(job, false)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <SendInterviewModal isOpen={openSendInterview} onClose={() => setOpenSendInterview(false)} />
      <SendAssessmentModal
        isOpen={openSendAssessment}
        defaultJobId={sendAssessmentJobId}
        onClose={() => setOpenSendAssessment(false)}
      />
      {openCreateJob ? (
        <CreateJobModal
          open={openCreateJob}
          setOpen={setOpenCreateJob}
          onSuccess={(newJobId) => {
            if (newJobId) {
              router.push(buildAuthUrl(`/jobs/${newJobId}/questionnaire`, searchParams))
            }
          }}
        />
      ) : null}
      <CreateJobModal
        open={openEditJob}
        setOpen={setOpenEditJob}
        mode="edit"
        initialJob={selectedJob}
        onSuccess={async () => {
          const response = await fetch(buildAuthUrl("/api/jobs?includeInactive=1", searchParams), {
            credentials: "include",
            cache: "no-store",
          })
          const data = await response.json()
          if (data?.error?.code === "FEATURE_NOT_IN_PLAN") {
            setLockedFeature(data.error.entitlement || "AI_INTERVIEW")
            return
          }
          if (data.success) {
            setJobs(data.jobs ?? [])
            setSupportsJobActiveState(Boolean(data.meta?.supportsJobActiveState))
            writeSessionJsonCache(cacheKey, {
              jobs: data.jobs ?? [],
              supportsJobActiveState: Boolean(data.meta?.supportsJobActiveState),
            })
          }
        }}
      />
    </div>
  )
}
