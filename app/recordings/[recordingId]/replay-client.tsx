"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, FileText, Gauge, Pause, Play, ShieldCheck, Video } from "lucide-react"

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
  const [data, setData] = useState<ReviewPayload | null>(null)
  const [error, setError] = useState("")
  const [activeId, setActiveId] = useState("")
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [videoMode, setVideoMode] = useState<"raw" | "mirror">("raw")
  const [isPlaying, setIsPlaying] = useState(false)

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

  function seekTo(ms: number, itemId?: string) {
    if (itemId) {
      setActiveId(itemId)
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

  return (
    <main className="hv-surface-page min-h-screen text-white">
      <section className="border-b border-slate-800 hv-surface-header px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/75">Enterprise Interview Replay</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{data.recording.candidateName}</h1>
            <p className="mt-2 text-sm text-slate-400">{data.recording.jobTitle} / Captured {formatDate(data.recording.createdAt)}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-4 xl:min-w-[720px]">
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <FileText className="h-4 w-4 text-cyan-200" />
              <p className="mt-3 text-xs text-slate-500">VERIS Questions</p>
              <p className="mt-1 text-2xl font-semibold">{data.summary.questionCount}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <Video className="h-4 w-4 text-blue-200" />
              <p className="mt-3 text-xs text-slate-500">Video Status</p>
              <p className="mt-1 truncate text-lg font-semibold capitalize">{data.recording.status ?? "ready"}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <AlertTriangle className="h-4 w-4 text-amber-200" />
              <p className="mt-3 text-xs text-slate-500">Review Flags</p>
              <p className="mt-1 text-2xl font-semibold">{data.summary.signalCount}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <Gauge className="h-4 w-4 text-rose-200" />
              <p className="mt-3 text-xs text-slate-500">Highest Review Confidence</p>
              <p className="mt-1 text-2xl font-semibold">{data.summary.maxFraudScore}%</p>
            </div>
          </div>
        </div>
      </section>

      {transcriptNeedsReview ? (
        <section className="mx-auto max-w-[1500px] px-4 pt-5 sm:px-6 lg:px-8">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-amber-100">
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

      <section className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(390px,0.75fr)] lg:px-8">
        <div className="min-w-0">
          <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-slate-800 hv-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Video orientation</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                RAW is the original recording. Mirror flips only the video frame for review.
              </p>
            </div>
            <div className="inline-grid h-10 shrink-0 grid-cols-2 rounded-xl border border-slate-700 bg-slate-950/50 p-1">
              {[
                ["mirror", "Mirror"],
                ["raw", "RAW"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setVideoMode(mode as "raw" | "mirror")}
                  aria-pressed={videoMode === mode}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${
                    videoMode === mode
                      ? "bg-cyan-400/15 text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.12)]"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Video className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-800 hv-surface-media shadow-[0_22px_80px_rgba(2,6,23,0.42)]">
            <video
              ref={videoRef}
              src={mediaUrl}
              playsInline
              className={`aspect-video w-full hv-surface-media object-contain ${videoMode === "mirror" ? "-scale-x-100" : ""}`}
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
            <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950 px-4 py-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={togglePlayback}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-400/10 text-cyan-100 transition hover:bg-cyan-400/20"
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
                className="h-2 min-w-0 flex-1 accent-cyan-300"
                aria-label="Recording playback position"
              />
              <p className="shrink-0 font-mono text-xs text-slate-400">
                {formatTime(currentTimeMs)} / {formatTime(videoDurationMs || fallbackDurationMs)}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-800 hv-surface-raised p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Review Flag Timeline</h2>
                <p className="mt-1 text-sm text-slate-500">Click any marker to jump to the evidence moment.</p>
              </div>
              <p className="font-mono text-sm text-cyan-100">{formatTime(currentTimeMs)}</p>
            </div>

            <div className="relative mt-6 h-16 rounded-xl border border-slate-800 bg-slate-950/55 px-3">
              <div className="absolute left-3 right-3 top-1/2 h-px bg-slate-700" />
              <div
                className="absolute top-4 h-8 w-px bg-cyan-200"
                style={{ left: `${Math.min(98, Math.max(2, (currentTimeMs / durationMs) * 100))}%` }}
              />
              {data.timeline.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => seekTo(item.offsetMs, item.id)}
                  className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 ${markerClass(item.riskLevel)}`}
                  style={{ left: `${Math.min(98, Math.max(2, (item.offsetMs / durationMs) * 100))}%` }}
                  title={`Q${item.index} / ${formatTime(item.offsetMs)} / Review flag ${scoreLabel(item.scores.fraud)}`}
                />
              ))}
              {data.signals.map((signal) => (
                <button
                  key={signal.id}
                  type="button"
                  onClick={() => seekTo(signal.offsetMs)}
                  className={`absolute top-[18px] h-3 w-3 -translate-x-1/2 rounded-sm border border-slate-950 ${markerClass(signal.severity)}`}
                  style={{ left: `${Math.min(98, Math.max(2, (signal.offsetMs / durationMs) * 100))}%` }}
                  title={`${signal.label} / ${formatTime(signal.offsetMs)}`}
                />
              ))}
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {data.signals.length > 0 ? (
                data.signals.slice(0, 8).map((signal) => (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => seekTo(signal.offsetMs)}
                    className={`flex items-start justify-between rounded-xl border px-3 py-3 text-left text-sm ${riskClass(signal.severity)}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{signal.label}</span>
                      <span className="mt-1 block text-xs leading-5 opacity-75">
                        {signal.description}
                      </span>
                    </span>
                    <span className="ml-3 font-mono text-xs">{formatTime(signal.offsetMs)}</span>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-3 text-sm text-emerald-100 md:col-span-2">
                  No review flags were detected for this recording.
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="min-w-0 rounded-2xl border border-slate-800 hv-surface-raised p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Synchronized Review</p>
              <h2 className="mt-2 text-xl font-semibold">Question, Transcript, Result</h2>
            </div>
            <ShieldCheck className="h-5 w-5 text-emerald-200" />
          </div>

          {activeItem ? (
            <article className="mt-5 rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${riskClass(activeItem.riskLevel)}`}>
                  Review Flag {scoreLabel(activeItem.scores.fraud)}
                </span>
                <button
                  type="button"
                  onClick={() => seekTo(activeItem.offsetMs, activeItem.id)}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100"
                >
                  <Play className="h-3.5 w-3.5" />
                  {formatTime(activeItem.offsetMs)}
                </button>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/70">VERIS Asking</p>
              <p className="mt-2 text-base leading-7 text-white">{activeItem.question || "Question unavailable."}</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/70">Candidate Transcript</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{activeItem.answer || "No candidate response recorded."}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {[
                  ["Skill", activeItem.scores.skill],
                  ["Clarity", activeItem.scores.clarity],
                  ["Depth", activeItem.scores.depth],
                  ["Confidence", activeItem.scores.confidence],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
                    <p className="text-slate-500">{label}</p>
                    <p className="mt-1 font-semibold text-slate-100">{scoreLabel(value as number | null)}</p>
                  </div>
                ))}
              </div>
              {activeItem.feedback ? (
                <p className="mt-4 rounded-lg border border-slate-800 hv-surface-sunken p-3 text-sm leading-6 text-slate-300">{activeItem.feedback}</p>
              ) : null}
            </article>
          ) : null}

          <div className="mt-4 max-h-[310px] space-y-2 overflow-auto pr-1">
            {data.timeline.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => seekTo(item.offsetMs, item.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                  activeItem?.id === item.id
                    ? "border-cyan-300/35 bg-cyan-300/10"
                    : "border-slate-800 bg-slate-950/25 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Q{item.index}</span>
                  <span className="font-mono text-xs text-slate-500">{formatTime(item.offsetMs)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-200">{item.question}</p>
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="mx-auto max-w-[1500px] px-4 pb-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-800 hv-surface-raised p-5">
          <h2 className="text-base font-semibold">Complete Transcript</h2>
          <pre className="mt-4 max-h-[420px] whitespace-pre-wrap overflow-auto rounded-xl border border-slate-800 bg-slate-950/45 p-4 text-sm leading-7 text-slate-300">{mergedTranscript}</pre>
        </div>
      </section>
    </main>
  )
}
