"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"

import BackToDashboardLink from "../../components/BackToDashboardLink"
import Navbar from "../../components/Navbar"
import SendInterviewModal from "../../components/SendInterviewModal"
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
        className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-medium ${
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
    <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-0 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-sm font-medium normal-case tracking-normal text-slate-200 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
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
  const preview =
    value.length > 44
      ? `${value.slice(0, 44).trimEnd()}...`
      : value || fallback

  return (
    <div className="group relative max-w-full">
      <div className="cursor-help break-words leading-6 text-slate-400">
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
  const value = items.join(", ")
  const preview =
    value.length > 46
      ? `${value.slice(0, 46).trimEnd()}...`
      : value || "-"

  return (
    <div className="group relative max-w-full">
      <div className="cursor-help break-words leading-6 text-slate-300">
        {preview}
      </div>

      {value ? (
        <div className="hv-preserve-dark pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-[460px] max-w-[38vw] rounded-2xl border border-slate-700 bg-[#1f2937] px-4 py-3 text-sm leading-7 text-slate-100 shadow-[0_18px_48px_rgba(2,6,23,0.45)] group-hover:block">
          <div className="line-clamp-[20] whitespace-pre-wrap break-words">
            {value}
          </div>
        </div>
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
  const actionMenuRef = useRef(null)

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

        if (!isMounted || !data.success) {
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
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
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

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />

      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-[0_14px_44px_rgba(2,6,23,0.22)]">
          <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Role Portfolio</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">All Jobs</h1>
              <p className="mt-4 text-base leading-7 text-slate-400">
                Live role inventory for your hiring organization, including experience band, evaluation depth, and current interview activity.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-4 xl:min-w-[680px]">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                <p className="text-sm text-slate-500">Total Jobs</p>
                <p className="mt-3 text-3xl font-semibold text-white">{stats.total}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                <p className="text-sm text-slate-500">Active Jobs</p>
                <p className="mt-3 text-3xl font-semibold text-white">{stats.activeJobs}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                <p className="text-sm text-slate-500">Active Interview Tracks</p>
                <p className="mt-3 text-3xl font-semibold text-white">{stats.totalInterviews}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                <p className="text-sm text-slate-500">Senior Roles</p>
                <p className="mt-3 text-3xl font-semibold text-white">{stats.seniorRoles}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)]">
          <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Created Job Roles</h2>
              <p className="mt-1 text-sm text-slate-400">
                Showing {filteredJobs.length} of {jobs.length} jobs created under the current recruiter organization.
              </p>
            </div>

            <div className="flex w-fit items-center gap-2">
              <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />

              <button
                type="button"
                onClick={() => {
                  setSelectedJob(null)
                  setOpenCreateJob(true)
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(124,58,237,0.22)] transition hover:bg-violet-500"
              >
                Create Job
              </button>
            </div>
          </div>

          <div className="grid gap-4 border-b border-slate-800 bg-slate-950/20 px-6 py-5 xl:grid-cols-[minmax(220px,1.2fr)_repeat(4,minmax(150px,0.7fr))_auto]">
            <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Search
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search title, skills, description"
                className="h-9 min-w-0 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-sm font-medium normal-case tracking-normal text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
              />
            </label>
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
              className="h-11 self-end rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              Clear
            </button>
          </div>

          <div className="hv-table-scroll">
            <table className="w-full table-fixed text-sm" style={{ minWidth: "1610px" }}>
                {/*
                  Column widths live here as real inline widths rather than
                  utility classes. The table is table-fixed, so these are the
                  only thing deciding column size, and a colgroup is honoured
                  by the browser directly with no dependency on CSS generation.
                  They sum to the table min-width so nothing is squeezed.
                */}
                <colgroup>
                  {[220, 260, 110, 110, 130, 100, 150, 200, 140, 190].map((width, index) => (
                    <col key={index} style={{ width: `${width}px` }} />
                  ))}
                </colgroup>
              <thead className="bg-slate-950/20 text-slate-400">
                <tr>
                  {/*
                    The table is table-fixed, so these widths are the only thing
                    deciding column size - cell content is ignored. Every column
                    needs one, or the browser splits the remaining space evenly
                    and narrow-looking columns like Job Title get crushed.
                  */}
                  <th className="px-4 py-4 text-left font-medium">Job Title</th>
                  <th className="px-4 py-4 text-left font-medium">Description</th>
                  <th className="whitespace-nowrap px-4 py-4 text-left font-medium">Status</th>
                  <th className="whitespace-nowrap px-4 py-4 text-left font-medium">Difficulty</th>
                  <th className="px-4 py-4 text-left font-medium">Experience Level</th>
                  <th className="whitespace-nowrap px-4 py-4 text-left font-medium">Timeline</th>
                  <th className="whitespace-nowrap px-4 py-4 text-left font-medium">Interview Mode</th>
                  <th className="px-4 py-4 text-left font-medium">Core Skills</th>
                  <th className="px-4 py-4 text-left font-medium">Open Interviews</th>
                  <th className="whitespace-nowrap px-4 py-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-slate-400">No jobs available</td>
                  </tr>
                ) : filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-slate-400">No jobs match the current filters</td>
                  </tr>
                ) : (
                  filteredJobs.map((job) => (
                    <tr key={job.jobId} className="border-t border-slate-800/80 align-top text-slate-200">
                      <td className="px-4 py-4 align-top">
                        <button
                          type="button"
                          onClick={() => handleEdit(job)}
                          title={`Edit ${job.jobTitle}`}
                          className="block w-full break-words rounded text-left font-medium leading-6 text-white underline-offset-4 transition hover:text-cyan-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                        >
                          {job.jobTitle}
                        </button>
                      </td>
                      <td className="px-4 py-4 text-slate-400">
                        <JobDescriptionCell description={job.jobDescription} />
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getStatusTone(job.isActive !== false)}`}>
                          {job.isActive !== false ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getDifficultyTone(job.difficultyProfile)}`}>
                          {job.difficultyProfile ?? "MID"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-300">{getExperienceLabel(job.experienceLevelId)}</td>
                      <td className="px-4 py-4 text-slate-300">{job.interviewDurationMinutes ?? 30} min</td>
                      <td className="px-4 py-4">
                        <InterviewModeCell
                          mode={job.interviewMode}
                          questionnaireStatus={job.questionnaireStatus}
                          versionNumber={job.questionnaireVersionNumber}
                          hasDraft={job.questionnaireHasDraft}
                        />
                      </td>
                      <td className="px-4 py-4 text-slate-300">
                        <JobSkillsCell skills={job.coreSkills} />
                      </td>
                      <td className="px-4 py-4 text-slate-300">{job._count?.interviews ?? 0}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-right">
                        <div className="flex justify-end">
                          <div
                            className="flex w-full items-center justify-end gap-2"
                            ref={openActionMenuJobId === job.jobId ? actionMenuRef : null}
                          >
                            {supportsJobActiveState ? (
                              <button
                                type="button"
                                onClick={() => handleToggleActive(job)}
                                disabled={pendingJobId === job.jobId}
                                className="hidden min-w-[108px] items-center justify-center rounded-xl border border-cyan-400/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.2),rgba(59,130,246,0.18))] px-3 py-2 text-xs font-semibold text-cyan-100 shadow-[0_10px_24px_rgba(8,145,178,0.16)] transition hover:border-cyan-300/50 hover:text-white hover:shadow-[0_14px_28px_rgba(8,145,178,0.24)] disabled:cursor-not-allowed disabled:opacity-60 lg:inline-flex"
                              >
                                {pendingJobId === job.jobId
                                  ? "Saving..."
                                  : job.isActive !== false
                                    ? "Mark Inactive"
                                    : "Mark Active"}
                              </button>
                            ) : null}

                            <div className="relative flex items-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenActionMenuJobId((current) =>
                                    current === job.jobId ? "" : job.jobId
                                  )
                                }
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/85 text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white"
                                aria-label={`Open actions for ${job.jobTitle}`}
                                aria-expanded={openActionMenuJobId === job.jobId}
                              >
                                <KebabIcon />
                              </button>

                              {openActionMenuJobId === job.jobId ? (
                                <div className="hv-preserve-dark absolute right-0 top-[calc(100%+10px)] z-30 w-44 overflow-hidden rounded-2xl border border-slate-800 bg-[#111a2d]/98 p-2 shadow-[0_20px_60px_rgba(2,6,23,0.42)]">
                                  {supportsJobActiveState ? (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleActive(job)}
                                      disabled={pendingJobId === job.jobId}
                                      className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
                                    >
                                      {pendingJobId === job.jobId
                                        ? "Saving..."
                                        : job.isActive !== false
                                          ? "Mark Inactive"
                                          : "Mark Active"}
                                    </button>
                                  ) : null}

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuJobId("")
                                      router.push(
                                        buildAuthUrl(`/jobs/${job.jobId}/questionnaire`, searchParams)
                                      )
                                    }}
                                    className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800/80 hover:text-white"
                                  >
                                    Interview questions
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuJobId("")
                                      handleEdit(job)
                                    }}
                                    className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800/80 hover:text-white"
                                  >
                                    Edit job
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuJobId("")
                                      setOpenSendInterview(true)
                                    }}
                                    className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800/80 hover:text-white"
                                  >
                                    Send interview link
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <SendInterviewModal isOpen={openSendInterview} onClose={() => setOpenSendInterview(false)} />
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
