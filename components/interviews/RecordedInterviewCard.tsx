"use client"

import { formatDateTime } from "@/lib/client/date-format"
import IntelligenceStatus from "./IntelligenceStatus"
import InterviewReplayAction from "./InterviewReplayAction"
import WarRoomAction from "./WarRoomAction"

type RecordedInterviewCardProps = {
  item: Record<string, any>
  organizationId?: string
  onOpenWarRoom?: () => void
  canOpenWarRoom?: boolean
  compact?: boolean
}

function getRecordingUrl(item: Record<string, any>) {
  return item?.recordingUrl || item?.audioUrl || ""
}

function getRetentionLabel(days: unknown) {
  return `Evidence Retention: ${days ?? 30} Days`
}

function getTranscriptPreview(item: Record<string, any>) {
  const preview = String(item?.transcriptPreview ?? "").trim()

  if (!preview || /^transcript not available yet$/i.test(preview)) {
    const summary = String(item?.aiSummaryPreview ?? "").trim()
    if (summary) {
      return summary
    }

    return "Transcript processing. VERIS analysis pending."
  }

  return preview
}

export default function RecordedInterviewCard({ item, onOpenWarRoom, canOpenWarRoom = true, compact = false }: RecordedInterviewCardProps) {
  const recordingUrl = getRecordingUrl(item)
  const hasRecording = Boolean(recordingUrl) && item?.hasRecordingFile !== false

  return (
    <article className="hv-theme-panel group relative min-w-0 overflow-hidden rounded-[24px] border border-slate-800 bg-[linear-gradient(180deg,rgba(17,26,46,0.96),rgba(8,17,31,0.98))] p-4 shadow-[0_18px_54px_rgba(2,6,23,0.28)] transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/25 hover:shadow-[0_24px_68px_rgba(2,6,23,0.36),0_0_46px_rgba(34,211,238,0.08)] sm:p-5">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/55 to-transparent opacity-70" />
      <div className="pointer-events-none absolute inset-x-4 top-20 h-6 opacity-55 transition group-hover:opacity-80" aria-hidden="true">
        <div className="flex h-full items-center gap-1">
          {[36, 20, 44, 26, 52, 18, 38, 28, 46, 22, 34, 48].map((height, index) => (
            <span key={index} className="w-1 flex-1 rounded-full bg-cyan-300/20" style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>

      <div className="relative z-10">
        <div className="min-w-0 pr-1">
          <p className="line-clamp-2 min-w-0 break-words text-lg font-semibold leading-6 text-white">{item.candidateName}</p>
          <p className="mt-1 line-clamp-2 min-w-0 break-words text-sm leading-5 text-slate-400">{item.jobTitle}</p>
        </div>

        <div className="mt-5 h-px bg-gradient-to-r from-cyan-300/25 via-slate-700/60 to-transparent" />

        <div className="mt-4 grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span className="min-w-0 break-words">Captured: <span className="text-blue-200">{formatDateTime(item.createdAt)}</span></span>
            <span className="text-slate-700">/</span>
            <span className="min-w-0 break-words text-fuchsia-200">{getRetentionLabel(item.retentionDays)}</span>
          </div>

          <div className="rounded-2xl border border-slate-800/90 bg-slate-950/30 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Evidence</p>
            <p className="mt-1.5 line-clamp-2 min-h-[38px] min-w-0 break-words text-[13px] leading-[19px] text-slate-300">{getTranscriptPreview(item)}</p>
          </div>

          <IntelligenceStatus
            transcriptPreview={item.transcriptPreview}
            transcriptReady={item.transcriptReady}
            cognitiveAnalysisReady={item.cognitiveAnalysisReady}
            hasRecording={hasRecording}
            compact={compact}
          />

          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800/80 bg-slate-950/25 p-3 text-xs">
            <div>
              <p className="line-clamp-2 min-w-0 break-words text-slate-500">Confidence Stability</p>
              <p className="mt-1 line-clamp-2 min-w-0 break-words font-semibold text-cyan-100">Calibrating</p>
            </div>
            <div>
              <p className="line-clamp-2 min-w-0 break-words text-slate-500">Review Indicators</p>
              <p className="mt-1 line-clamp-2 min-w-0 break-words font-semibold text-emerald-200">Signal Ready</p>
            </div>
            <div>
              <p className="line-clamp-2 min-w-0 break-words text-slate-500">Stress Variance</p>
              <p className="mt-1 line-clamp-2 min-w-0 break-words font-semibold text-blue-100">Reviewable</p>
            </div>
            <div>
              <p className="line-clamp-2 min-w-0 break-words text-slate-500">Clarity Index</p>
              <p className="mt-1 line-clamp-2 min-w-0 break-words font-semibold text-slate-200">Pending Score</p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          <InterviewReplayAction href={hasRecording ? recordingUrl : ""} candidateName={item.candidateName} compact={compact} />
          {canOpenWarRoom && onOpenWarRoom ? (
            <WarRoomAction onOpen={onOpenWarRoom} candidateName={item.candidateName} compact={compact} />
          ) : null}
        </div>
      </div>
    </article>
  )
}
