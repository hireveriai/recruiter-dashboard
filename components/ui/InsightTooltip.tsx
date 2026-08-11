"use client"

import { createPortal } from "react-dom"
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"

type InsightTooltipProps = {
  text: string
  preview?: ReactNode
  showHint?: boolean
}

export function InsightTooltip({ text, preview, showHint = true }: InsightTooltipProps) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const tooltipId = useId()
  const insightText = text.trim() || "-"
  const hasInsight = insightText !== "-"
  const sections = useMemo(() => {
    const lines = insightText.split("\n").map((line) => line.trim()).filter(Boolean)
    const getValue = (label: string) => {
      const line = lines.find((item) => item.toLowerCase().startsWith(`${label.toLowerCase()}:`))
      return line ? line.slice(label.length + 1).trim() : ""
    }

    return {
      strengths: getValue("Strengths"),
      gaps: getValue("Gaps"),
      verdict: getValue("Verdict"),
      reasoning: getValue("Reasoning"),
    }
  }, [insightText])

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()

    if (!rect) {
      return
    }

    const tooltipWidth = 380
    const viewportPadding = 16
    const preferredLeft = rect.left - tooltipWidth - 12
    const fallbackLeft = rect.right + 12
    const left = preferredLeft >= viewportPadding
      ? preferredLeft
      : Math.min(Math.max(fallbackLeft, viewportPadding), window.innerWidth - tooltipWidth - viewportPadding)
    const top = Math.min(
      Math.max(rect.top - 8, viewportPadding),
      window.innerHeight - viewportPadding - 24
    )

    setPosition({
      left,
      top,
    })
  }, [])

  useEffect(() => {
    if (!hovered || !hasInsight) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      updatePosition()
      setOpen(true)
    }, 150)

    return () => window.clearTimeout(timeoutId)
  }, [hovered, hasInsight, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleReposition = () => updatePosition()

    window.addEventListener("scroll", handleReposition, true)
    window.addEventListener("resize", handleReposition)

    return () => {
      window.removeEventListener("scroll", handleReposition, true)
      window.removeEventListener("resize", handleReposition)
    }
  }, [open, updatePosition])

  function showTooltip() {
    if (!hasInsight) {
      return
    }

    updatePosition()
    setOpen(true)
  }

  const tooltip = hasInsight && open && typeof document !== "undefined" ? createPortal(
    <div
      id={tooltipId}
      role="tooltip"
      className="hv-preserve-dark fixed z-[9999] min-w-[300px] max-w-[380px] rounded-xl border border-white/10 bg-[#0B1220] p-4 text-[12px] leading-[1.45] text-gray-200 opacity-100 shadow-2xl shadow-slate-950/50 transition duration-150 ease-out animate-in fade-in-0 slide-in-from-bottom-1"
      style={{ left: position.left, top: position.top }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setOpen(false)
      }}
    >
      <div className="space-y-3">
        {sections.strengths ? (
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">Strengths</p>
            <p className="mt-1 text-slate-200">{sections.strengths}</p>
          </section>
        ) : null}
        {sections.gaps ? (
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300/80">Gaps</p>
            <p className="mt-1 text-slate-200">{sections.gaps}</p>
          </section>
        ) : null}
        {sections.verdict ? (
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300/80">Verdict</p>
            <p className="mt-1 text-slate-200">{sections.verdict}</p>
          </section>
        ) : null}
        {sections.reasoning ? (
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Reasoning</p>
            <p className="mt-1 text-slate-200">{sections.reasoning}</p>
          </section>
        ) : null}
        {!sections.strengths && !sections.gaps && !sections.verdict && !sections.reasoning ? (
          <p className="whitespace-pre-line text-slate-200">{insightText}</p>
        ) : null}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <span
      className="block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="block w-full cursor-pointer text-left"
        onClick={() => {
          if (open) {
            setOpen(false)
            setHovered(false)
            return
          }

          showTooltip()
        }}
        onFocus={showTooltip}
        onBlur={() => {
          setOpen(false)
          setHovered(false)
        }}
        aria-describedby={hasInsight ? tooltipId : undefined}
        aria-expanded={open}
        aria-label={hasInsight ? "View full insight" : "No insight available"}
        disabled={!hasInsight}
      >
        {preview ?? (
          <p className="line-clamp-2 text-sm leading-6 text-slate-400">
            {insightText}
          </p>
        )}

        {showHint && hasInsight ? (
          <span className="mt-1 block text-xs text-slate-600">Hover to view full insight</span>
        ) : null}
      </button>

      {tooltip}
    </span>
  )
}
