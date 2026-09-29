"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, Maximize2, Minimize2, Pause, Play, ShieldCheck } from "lucide-react"

import { buildAuthUrl } from "@/lib/client/auth-query"

type RiskLevel = "low" | "medium" | "high"

type TimelineItem = {
  id: string
  index: number
  question: string
  source: string
  answer: string
  askedAt: string | null
  answeredAt: string | null
  offsetMs: number
  answerOffsetMs: number | null
  scores: {
    skill: number | null
    clarity: number | null
    depth: number | null
    confidence: number | null
    fraud: number | null
  }
  feedback: string | null
  riskLevel: RiskLevel
}

type SignalItem = {
  id: string
  type: string
  label: string
  description: string
  severity: RiskLevel
  occurredAt: string | null
  offsetMs: number
}

type ReviewPayload = {
  recording: {
    id: string
    attemptId: string
    candidateName: string
    jobTitle: string
    status: string | null
    startedAt: string | null
    endedAt: string | null
    createdAt: string | null
    transcript: string | null
    transcriptStatus: string | null
    mediaUrl: string
    durationMs: number | null
  }
  timeline: TimelineItem[]
  signals: SignalItem[]
  summary: {
    questionCount: number
    signalCount: number
    highRiskCount: number
    maxFraudScore: number
  }
}

function formatTime(ms: number) {
  const safeMs = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

function formatDate(value: string | null) {
  if (!value) {
    return "-"
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

// Names typed entirely in capitals (or lowercase) show in title case;
// mixed-case names stay as entered.
function displayName(name: string) {
  const value = String(name ?? "").trim()
  if (!value) return "Candidate"
  if (value !== value.toUpperCase() && value !== value.toLowerCase()) return value
  return value.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase())
}

function formatStatus(value: string) {
  const text = value.replace(/_/g, " ").toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function scoreLabel(value: number | null) {
  return value === null ? "-" : `${value}%`
}

function riskClass(level: RiskLevel) {
  if (level === "high") {
    return "border-rose-400/35 bg-rose-500/12 text-rose-100"
  }

  if (level === "medium") {
    return "border-amber-300/35 bg-amber-400/12 text-amber-100"
  }

  return "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
}

function markerClass(level: RiskLevel) {
  if (level === "high") {
    return "bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,0.7)]"
  }

  if (level === "medium") {
    return "bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.55)]"
  }

  return "bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.5)]"
}

function getMergedTranscript(timeline: TimelineItem[], fallback: string | null) {
  if (timeline.length === 0) {
    return fallback || "Transcript is still processing."
  }

  return timeline
    .map((item) => [
      `VERIS Q${item.index}: ${item.question || "Question unavailable"}`,
      `Candidate A${item.index}: ${item.answer || "No candidate response recorded."}`,
    ].join("\n"))
    .join("\n\n")
}

export default function ReplayClient({ recordingId }: { recordingId: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoFrameRef = useRef<HTMLDivElement | null>(null)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const [data, setData] = useState<ReviewPayload | null>(null)
  const [error, setError] = useState("")
  const [activeId, setActiveId] = useState("")
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [videoMode, setVideoMode] = useState<"raw" | "mirror">("raw")
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // The question whose long answer is shown in full.
  const [expandedId, setExpandedId] = useState("")

  // The frame — video plus its own controls — goes fullscreen rather than the
  // bare <video>, so the scrubber and orientation toggle stay reachable.
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === videoFrameRef.current)

    document.addEventListener("fullscreenchange", syncFullscreen)
    return () => document.removeEventListener("fullscreenchange", syncFullscreen)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const frame = videoFrameRef.current
    if (!frame) {
      return
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      void frame.requestFullscreen().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const query = typeof window !== "undefined" ? window.location.search : ""

    fetch(`/api/recordings/${encodeURIComponent(recordingId)}/review${query}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(payload?.error?.message || payload?.message || "Unable to load recording review")
        }
        return payload as ReviewPayload
      })
      .then((payload) => {
        if (isMounted) {
          setData(payload)
          setActiveId(payload.timeline[0]?.id ?? "")
        }
      })
      .catch((loadError) => {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load recording review")
        }
      })

    return () => {
      isMounted = false
    }
  }, [recordingId])

  const activeItem = useMemo(() => {
    if (!data) {
      return null
    }

    return data.timeline.find((item) => item.id === activeId) ?? data.timeline[0] ?? null
  }, [activeId, data])

  const fallbackDurationMs = data?.recording.durationMs ?? 0
  const durationMs = Math.max(
    1,
    videoDurationMs,
    fallbackDurationMs,
    ...(data?.timeline.map((item) => item.offsetMs) ?? [0]),
    ...(data?.signals.map((item) => item.offsetMs) ?? [0]),
  )

  const mergedTranscript = data ? getMergedTranscript(data.timeline, data.recording.transcript) : ""
  const transcriptNeedsReview = !data?.recording.transcript?.trim() &&
    data?.timeline.every((item) => !item.answer.trim()) &&
    ["PARTIAL", "PENDING", "FAILED"].includes(data?.recording.transcriptStatus?.toUpperCase() ?? "PENDING")
  const mediaUrl = data
    ? `${data.recording.mediaUrl}${typeof window !== "undefined" ? window.location.search : ""}`
    : ""
  const downloadUrl = mediaUrl ? `${mediaUrl}${mediaUrl.includes("?") ? "&" : "?"}download=1` : ""

  /**
   * Brings a question's block into view inside the transcript panel only.
   *
   * The block is looked up in the DOM rather than through a ref map: playback
   * re-renders this component on every timeupdate, which detaches and
   * reattaches element refs constantly, and the lookup has to be reliable at
   * the instant of the click.
   */
  function revealTranscript(itemId: string) {
    const container = transcriptScrollRef.current
    const block = container?.querySelector<HTMLElement>(`[data-transcript-id="${CSS.escape(itemId)}"]`)

    if (!container || !block) {
      return
    }

    // scrollIntoView would drag the whole page around, so the offset is
    // applied to the transcript's own scroll box instead. The jump is
    // deliberately instant: a smooth scroll is silently dropped by browsers
    // with reduced motion enabled, which would leave the panel unmoved.
    container.scrollTop = Math.max(0, block.offsetTop - 12)
  }

  function seekTo(ms: number, itemId?: string) {
    if (itemId) {
      setActiveId(itemId)
      revealTranscript(itemId)
    }

    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, ms / 1000)
      void videoRef.current.play().catch(() => undefined)
    }
  }

  function togglePlayback() {
    const video = videoRef.current
    if (!video) {
      return
    }

    if (video.paused) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }

  function seekFromRange(value: string) {
    const video = videoRef.current
    const nextMs = Number(value)

    if (!video || !Number.isFinite(nextMs)) {
      return
    }

    video.currentTime = Math.max(0, nextMs / 1000)
    setCurrentTimeMs(Math.max(0, Math.round(nextMs)))
  }

  function updateVideoDuration(video: HTMLVideoElement) {
    const durationSeconds = video.duration

    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      setVideoDurationMs(Math.round(durationSeconds * 1000))
    }
  }

  if (error) {
    return (
      <main className="hv-surface-page min-h-screen px-6 py-8 text-white">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-400/25 bg-rose-500/10 p-6 text-rose-100">
          {error}
        </div>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="hv-surface-page min-h-screen px-6 py-8 text-white">
        <div className="mx-auto max-w-6xl animate-pulse space-y-5">
          <div className="h-28 rounded-2xl bg-slate-800/60" />
          <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
            <div className="aspect-video rounded-2xl bg-slate-800/60" />
            <div className="rounded-2xl bg-slate-800/60" />
          </div>
        </div>
      </main>
    )
  }

  const timeline = data.timeline
  const activeIndex = activeItem ? timeline.findIndex((item) => item.id === activeItem.id) : -1
  const answerExpanded = Boolean(activeItem && expandedId === activeItem.id)
  const answerIsLong = (activeItem?.answer.length ?? 0) > 520
  const backHref = buildAuthUrl("/interviews", new URLSearchParams(typeof window !== "undefined" ? window.location.search : ""))
  const markerLeft = (ms: number) => `${Math.min(98, Math.max(2, (ms / durationMs) * 100))}%`

  const stats: Array<[string, string, string]> = [
    ["Questions", String(data.summary.questionCount), "text-white"],
    ["Video", formatStatus(data.recording.status ?? "ready"), "text-white"],
    ["Review flags", String(data.summary.signalCount), data.summary.signalCount > 0 ? "text-amber-200" : "text-white"],
    [
      "Highest integrity risk",
      `${data.summary.maxFraudScore}%`,
      data.summary.maxFraudScore >= 60 ? "text-rose-200" : data.summary.maxFraudScore >= 30 ? "text-amber-200" : "text-emerald-200",
    ],
  ]

  return (
    <main className="hv-surface-page min-h-screen text-white">
      <section className="border-b border-slate-800 hv-surface-header px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <a href={backHref} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to Interviews
            </a>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Interview Replay</p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]" title={data.recording.candidateName}>
              {displayName(data.recording.candidateName)}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {data.recording.jobTitle} <span className="text-slate-600">&middot;</span> Captured {formatDate(data.recording.createdAt)}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[640px]">
            {stats.map(([label, value, tone]) => (
              <div key={label} className="hv-surface-inset-soft rounded-xl border border-slate-800 bg-slate-950/35 px-3.5 py-2.5">
                <dt className="text-[11px] text-slate-500">{label}</dt>
                <dd className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {transcriptNeedsReview ? (
        <section className="mx-auto max-w-[1500px] px-4 pt-5 sm:px-6 lg:px-8">
          <div className="flex items-start gap-3 rounded-xl border border-amber-300/30 bg-amber-400/10 p-4 text-amber-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Transcript recovery required</p>
              <p className="mt-1 text-sm leading-6 text-amber-100/75">
                The video is available, but no candidate speech was captured by live transcription. This interview has been flagged for recording-based recovery.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.8fr)] lg:items-start lg:px-8">
        {/* On tall screens the player stays in view while the review column scrolls. */}
        <div className="min-w-0 space-y-4 lg:[@media(min-height:860px)]:sticky lg:[@media(min-height:860px)]:top-4">
          <div
            ref={videoFrameRef}
            className="hv-replay-frame overflow-hidden rounded-xl border border-slate-800 hv-surface-media shadow-[0_22px_80px_rgba(2,6,23,0.42)]"
          >
            <video
              ref={videoRef}
              src={mediaUrl}
              playsInline
              className={`hv-replay-video aspect-video w-full hv-surface-media object-contain ${videoMode === "mirror" ? "-scale-x-100" : ""}`}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onTimeUpdate={(event) => setCurrentTimeMs(Math.round(event.currentTarget.currentTime * 1000))}
              onLoadedMetadata={(event) => {
                setCurrentTimeMs(Math.round(event.currentTarget.currentTime * 1000))
                updateVideoDuration(event.currentTarget)
              }}
              onDurationChange={(event) => updateVideoDuration(event.currentTarget)}
            />
            <div className="hv-surface-inset-soft flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-slate-800 bg-slate-950 px-3 py-2.5 sm:px-4">
              <button
                type="button"
                onClick={togglePlayback}
                className="hv-solid-action inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-white transition hover:bg-cyan-500"
                aria-label={isPlaying ? "Pause recording" : "Play recording"}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(videoDurationMs, fallbackDurationMs, currentTimeMs, 1)}
                value={Math.min(currentTimeMs, Math.max(videoDurationMs, fallbackDurationMs, currentTimeMs, 1))}
                onChange={(event) => seekFromRange(event.target.value)}
                className="h-2 min-w-[120px] flex-1 accent-cyan-500"
                aria-label="Recording playback position"
              />
              <p className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
                {formatTime(currentTimeMs)} / {formatTime(videoDurationMs || fallbackDurationMs)}
              </p>
              <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                <div
                  role="group"
                  aria-label="Video orientation"
                  title="RAW is the original recording. Mirror flips only the video frame for review."
                  className="inline-grid h-9 grid-cols-2 rounded-lg border border-slate-700 bg-slate-900/60 p-0.5"
                >
                  {[
                    ["mirror", "Mirror"],
                    ["raw", "RAW"],
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setVideoMode(mode as "raw" | "mirror")}
                      aria-pressed={videoMode === mode}
                      className={`inline-flex items-center justify-center rounded-md px-2.5 text-xs font-semibold transition ${
                        videoMode === mode ? "bg-cyan-400/15 text-cyan-100" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100"
                  aria-label={isFullscreen ? "Exit full screen" : "Watch full screen"}
                  title={isFullscreen ? "Exit full screen" : "Watch full screen"}
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  <span className="hidden xl:inline">{isFullscreen ? "Exit" : "Full screen"}</span>
                </button>
                <a
                  href={downloadUrl}
                  download
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100"
                  aria-label="Download recording"
                  title="Download recording"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden xl:inline">Download</span>
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 hv-surface-raised p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Integrity Risk Timeline</h2>
                <p className="mt-0.5 text-xs text-slate-500">Click any marker to jump to that moment.</p>
              </div>
              <p className="font-mono text-sm tabular-nums text-cyan-200">{formatTime(currentTimeMs)}</p>
            </div>

            {/* Two lanes: questions on top, review flags below, so markers at
                the same moment no longer sit on top of each other. */}
            <div className="hv-surface-inset-soft relative mt-4 h-[76px] rounded-lg border border-slate-800 bg-slate-950/55">
              <div className="absolute left-3 right-3 top-[26px] h-px bg-slate-700" aria-hidden="true" />
              <div className="absolute left-3 right-3 top-[56px] h-px border-t border-dashed border-slate-700/70" aria-hidden="true" />
              <div className="absolute inset-x-3 inset-y-0">
                <div
                  className="absolute top-1.5 bottom-1.5 w-0.5 -translate-x-1/2 rounded-full bg-cyan-400"
                  style={{ left: markerLeft(currentTimeMs) }}
                  aria-hidden="true"
                />
                {timeline.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => seekTo(item.offsetMs, item.id)}
                    className={`absolute top-[26px] flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-slate-950 text-[9px] font-bold text-slate-950 transition hover:scale-125 ${markerClass(item.riskLevel)} ${
                      activeItem?.id === item.id ? "ring-2 ring-cyan-300/70 ring-offset-1 ring-offset-slate-950" : ""
                    }`}
                    style={{ left: markerLeft(item.offsetMs) }}
                    aria-label={`Question ${item.index} at ${formatTime(item.offsetMs)}, integrity risk ${scoreLabel(item.scores.fraud)}`}
                    title={`Q${item.index} / ${formatTime(item.offsetMs)} / Integrity risk ${scoreLabel(item.scores.fraud)}`}
                  >
                    {item.index}
                  </button>
                ))}
                {data.signals.map((signal) => (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => seekTo(signal.offsetMs)}
                    className={`absolute top-[56px] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border border-slate-950 transition hover:scale-125 ${markerClass(signal.severity)}`}
                    style={{ left: markerLeft(signal.offsetMs) }}
                    aria-label={`${signal.label} at ${formatTime(signal.offsetMs)}`}
                    title={`${signal.label} / ${formatTime(signal.offsetMs)}`}
                  />
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" aria-hidden="true" /> Question
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rotate-45 rounded-[1px] bg-slate-400" aria-hidden="true" /> Review flag
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-300" aria-hidden="true" /> Medium
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-400" aria-hidden="true" /> High
              </span>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {data.signals.length > 0 ? (
                data.signals.slice(0, 8).map((signal) => (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => seekTo(signal.offsetMs)}
                    className={`flex items-start justify-between rounded-lg border px-3 py-2.5 text-left text-sm ${riskClass(signal.severity)}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{signal.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 opacity-75">{signal.description}</span>
                    </span>
                    <span className="ml-3 font-mono text-xs">{formatTime(signal.offsetMs)}</span>
                  </button>
                ))
              ) : (
                <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2.5 text-sm text-emerald-100 md:col-span-2">
                  No integrity risks were detected for this recording.
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="min-w-0 rounded-xl border border-slate-800 hv-surface-raised p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Synchronized Review</p>
              <h2 className="mt-1 text-base font-semibold">
                {activeItem ? `Question ${activeItem.index} of ${timeline.length}` : "Question, Transcript, Result"}
              </h2>
            </div>
            {timeline.length > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const previous = timeline[activeIndex - 1]
                    if (previous) seekTo(previous.offsetMs, previous.id)
                  }}
                  disabled={activeIndex <= 0}
                  aria-label="Previous question"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = timeline[activeIndex + 1]
                    if (next) seekTo(next.offsetMs, next.id)
                  }}
                  disabled={activeIndex >= timeline.length - 1}
                  aria-label="Next question"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            )}
          </div>

          {timeline.length > 0 ? (
            <div role="list" aria-label="Questions" className="mt-4 grid grid-cols-5 gap-1.5">
              {timeline.map((item) => {
                const selected = activeItem?.id === item.id
                return (
                  <button
                    key={item.id}
                    role="listitem"
                    type="button"
                    onClick={() => seekTo(item.offsetMs, item.id)}
                    aria-current={selected ? "true" : undefined}
                    title={item.question}
                    className={`relative rounded-lg border px-1 py-1.5 text-center transition ${
                      selected
                        ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
                        : "hv-surface-inset-soft border-slate-800 bg-slate-950/25 text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    {item.riskLevel !== "low" ? (
                      <span
                        className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${item.riskLevel === "high" ? "bg-rose-400" : "bg-amber-300"}`}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="block text-xs font-semibold">Q{item.index}</span>
                    <span className="block font-mono text-[10px] text-slate-500">{formatTime(item.offsetMs)}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {activeItem ? (
            <article className="hv-surface-inset-soft mt-4 rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${riskClass(activeItem.riskLevel)}`}>
                  Integrity risk {scoreLabel(activeItem.scores.fraud)}
                </span>
                <button
                  type="button"
                  onClick={() => seekTo(activeItem.offsetMs, activeItem.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                >
                  <Play className="h-3.5 w-3.5" />
                  Play from {formatTime(activeItem.offsetMs)}
                </button>
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">VERIS asked</p>
              <p className="mt-1.5 text-[15px] font-medium leading-6 text-white">{activeItem.question || "Question unavailable."}</p>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Candidate answer</p>
              <p className={`mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-300 ${answerIsLong && !answerExpanded ? "line-clamp-[9]" : ""}`}>
                {activeItem.answer || "No candidate response recorded."}
              </p>
              {answerIsLong ? (
                <button
                  type="button"
                  onClick={() => setExpandedId(answerExpanded ? "" : activeItem.id)}
                  aria-expanded={answerExpanded}
                  className="mt-1.5 text-xs font-semibold text-cyan-300 transition hover:text-cyan-200"
                >
                  {answerExpanded ? "Show less" : "Show full answer"}
                </button>
              ) : null}

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
                {([
                  ["Skill", activeItem.scores.skill],
                  ["Clarity", activeItem.scores.clarity],
                  ["Depth", activeItem.scores.depth],
                  ["Confidence", activeItem.scores.confidence],
                ] as Array<[string, number | null]>).map(([label, value]) => (
                  <div key={label}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-500">{label}</span>
                      <span className="font-semibold tabular-nums text-slate-100">{scoreLabel(value)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
                      {value !== null ? (
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {activeItem.feedback ? (
                <p className="mt-4 rounded-lg border border-slate-800 hv-surface-sunken p-3 text-sm leading-6 text-slate-300">{activeItem.feedback}</p>
              ) : null}
            </article>
          ) : (
            <p className="mt-4 rounded-xl border border-slate-800 px-4 py-6 text-center text-sm text-slate-400">No questions were recorded for this interview.</p>
          )}
        </aside>
      </section>

      <section className="mx-auto max-w-[1500px] px-4 pb-8 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-slate-800 hv-surface-raised p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Complete Transcript</h2>
            {timeline.length > 0 ? (
              <p className="text-xs text-slate-500">Selecting a question jumps to it here. Click a question time to play from there.</p>
            ) : null}
          </div>
          {timeline.length > 0 ? (
            <div
              ref={transcriptScrollRef}
              className="hv-surface-inset-soft relative mt-4 max-h-[560px] space-y-1 overflow-auto rounded-xl border border-slate-800 bg-slate-950/45 p-2 sm:p-3"
            >
              {timeline.map((item) => (
                <div
                  key={item.id}
                  data-transcript-id={item.id}
                  className={`scroll-mt-4 rounded-lg px-3 py-3 sm:px-4 ${activeItem?.id === item.id ? "hv-transcript-active" : ""}`}
                >
                  <div className="grid gap-x-4 gap-y-2 md:grid-cols-[112px_minmax(0,1fr)]">
                    <button
                      type="button"
                      onClick={() => seekTo(item.offsetMs, item.id)}
                      className="inline-flex h-fit w-fit items-center gap-1.5 rounded-md border border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100"
                      aria-label={`Play question ${item.index} from ${formatTime(item.offsetMs)}`}
                    >
                      Q{item.index}
                      <span className="font-mono font-normal text-slate-500">{formatTime(item.offsetMs)}</span>
                    </button>
                    <div className="min-w-0 max-w-[90ch] space-y-2.5">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300/80">VERIS</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm font-medium leading-6 text-white">
                          {item.question || "Question unavailable"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">Candidate</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                          {item.answer || "No candidate response recorded."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <pre className="hv-surface-inset-soft mt-4 max-h-[560px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/45 p-4 font-sans text-sm leading-7 text-slate-300">{mergedTranscript}</pre>
          )}
        </div>
      </section>
    </main>
  )
}
