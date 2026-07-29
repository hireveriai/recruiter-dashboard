"use client"

import { ArrowRight, Radar } from "lucide-react"

type WarRoomActionProps = {
  onOpen: () => void
  candidateName?: string
  compact?: boolean
}

export default function WarRoomAction({ onOpen, candidateName = "candidate", compact = false }: WarRoomActionProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`hv-preserve-dark group/war relative inline-flex w-full min-w-0 transform-gpu items-center justify-between gap-3 overflow-hidden rounded-2xl border border-cyan-300/16 bg-[linear-gradient(135deg,rgba(8,47,73,0.42),rgba(15,23,42,0.72))] text-left text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] transition-all duration-200 hover:-translate-y-px hover:border-cyan-300/30 hover:bg-cyan-500/10 hover:text-white hover:shadow-[0_18px_42px_rgba(2,6,23,0.26),0_0_28px_rgba(34,211,238,0.08)] focus:outline-none focus:ring-2 focus:ring-cyan-300/25 ${
        compact ? "px-4 py-3" : "px-4 py-3.5"
      }`}
      aria-label={`Open War Room evidence review for ${candidateName}`}
    >
      <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/55 to-transparent opacity-80" />
      <span className="relative z-10 flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-300/10 text-cyan-100 transition group-hover/war:border-cyan-200/25 group-hover/war:bg-cyan-300/15">
          <Radar className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">Open War Room</span>
          <span className="mt-1 hidden truncate text-xs text-cyan-100/62 transition group-hover/war:text-cyan-50/80 sm:block">Evidence, audit trail, and behavioral review</span>
        </span>
      </span>
      <span className="relative z-10 shrink-0 text-cyan-100 transition group-hover/war:translate-x-0.5">
        <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
      </span>
    </button>
  )
}
