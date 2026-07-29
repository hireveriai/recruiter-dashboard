"use client"

import { Activity, ArrowRight, ShieldCheck } from "lucide-react"

import { openWarRoom } from "@/lib/client/war-room"

export default function WarRoomButton({ organizationId = "" }) {
  return (
    <div className="mt-10 flex justify-center">
      <button
        type="button"
        onClick={() => openWarRoom(organizationId)}
      className="hv-preserve-dark group relative inline-flex min-w-[280px] transform-gpu cursor-pointer items-center justify-between overflow-hidden rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.88),rgba(15,23,42,0.94))] px-5 py-4 text-left shadow-[0_18px_54px_rgba(2,6,23,0.32),0_0_32px_rgba(34,211,238,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-300/35 hover:shadow-[0_24px_70px_rgba(2,6,23,0.42),0_0_42px_rgba(34,211,238,0.14)] focus:outline-none focus:ring-2 focus:ring-cyan-300/25"
      >
        <span className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
        <span className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full bg-cyan-300/10 blur-2xl transition group-hover:bg-cyan-300/16" />
        <span className="relative z-10 flex min-w-0 items-center gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/18 bg-cyan-300/10 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
            <span className="absolute -right-1 -top-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-300/55 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-3 w-3 rounded-full border border-cyan-100/60 bg-cyan-300" />
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold tracking-tight text-white">Open War Room</span>
            <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-cyan-100/70">
              <Activity className="h-3.5 w-3.5" strokeWidth={1.8} />
              Reviewable interview evidence
            </span>
          </span>
        </span>
        <span className="relative z-10 ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.045] text-cyan-100 transition duration-200 group-hover:translate-x-0.5 group-hover:border-cyan-200/25 group-hover:bg-cyan-300/10">
          <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
        </span>
      </button>
    </div>
  )
}
