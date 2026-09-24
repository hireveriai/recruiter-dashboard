"use client"

import { useState } from "react"

const OPTIONS = [
  {
    value: "AI",
    title: "VERIS AI Interview",
    description: "AI-led interview conducted by VERIS.",
    supporting: "Automated · Candidate interviews independently",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="5" y="7" width="14" height="11" rx="3" />
        <path d="M12 3v4M9 12h.01M15 12h.01M9.5 15.5h5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: "LIVE",
    title: "VERIS Live Interview",
    description: "Live interview with your interviewer or interview panel.",
    supporting: "Human-led · Video interview",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="6" width="13" height="12" rx="2.5" />
        <path d="M16 10.5 21 7.5v9l-5-3" strokeLinejoin="round" />
      </svg>
    ),
  },
]

export default function InterviewTypeChooser({ onCancel, onContinue }) {
  const [selected, setSelected] = useState("AI")

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-interview-type-title"
    >
      <div className="relative w-full max-w-xl rounded-[28px] border border-slate-800 bg-slate-900 p-5 text-white shadow-[0_0_60px_rgba(37,99,235,0.18)] sm:p-6">
        <h2 id="send-interview-type-title" className="text-2xl font-semibold tracking-tight text-white">
          Send Interview Link
        </h2>
        <p className="mt-1 text-sm text-slate-400">Choose Interview Type</p>

        <div role="radiogroup" aria-labelledby="send-interview-type-title" className="mt-5 grid gap-3">
          {OPTIONS.map((option) => {
            const active = selected === option.value
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition ${
                  active ? "border-cyan-400/40 bg-cyan-400/10" : "border-slate-700 bg-slate-900/80 hover:border-slate-500"
                }`}
              >
                <input
                  type="radio"
                  name="interview-type"
                  value={option.value}
                  checked={active}
                  onChange={() => setSelected(option.value)}
                  className="mt-1 h-4 w-4 accent-cyan-400"
                />
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    active ? "bg-cyan-400/10 text-cyan-300" : "bg-slate-800/60 text-slate-300"
                  }`}
                >
                  {option.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-white">{option.title}</span>
                  <span className="mt-0.5 block text-sm text-slate-300">{option.description}</span>
                  <span className="mt-1 block text-xs italic text-slate-400">{option.supporting}</span>
                </span>
              </label>
            )
          })}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onContinue(selected)}
            className="hv-solid-action rounded-xl bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8]"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
