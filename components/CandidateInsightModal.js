"use client"

export default function CandidateInsightModal({ isOpen, onClose, candidateName, summary }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#020817]/80 px-4 py-4 backdrop-blur-md sm:py-6" role="dialog" aria-modal="true">
      <div className="hv-preserve-dark relative w-full max-w-3xl overflow-hidden rounded-[28px] border border-blue-400/20 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(9,14,28,0.98))] shadow-[0_0_80px_rgba(59,130,246,0.12)]">
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/70 to-transparent" />

        <div className="flex items-center justify-between border-b border-white/10 px-8 py-6">
          <div>
            <h3 className="text-2xl font-semibold text-white">VERIS Insight</h3>
            <p className="mt-2 text-sm text-slate-400">
              {candidateName || "Candidate"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-blue-400/25 bg-blue-400/10 px-4 py-2 text-sm text-blue-100 transition hover:bg-blue-400/20"
          >
            Close
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto px-8 py-6 text-sm leading-7 text-slate-300 whitespace-pre-wrap">
          {summary || "-"}
        </div>
      </div>
    </div>
  )
}
