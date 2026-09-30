"use client"

import Link from "next/link"
import { useEffect } from "react"

import EmployeeFlowGuide from "@/components/employees/EmployeeFlowGuide"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatLabel } from "@/lib/client/format-label"

/**
 * Shared pieces for the Employees area (Employees / Departments / Projects)
 * and employee assessment targeting. Same slate + cyan classes as the
 * Assessments pages, which globals.css remaps for the light theme, so one
 * set of classes serves both themes.
 */

export const FIELD_CLASS =
  "h-10 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"

export const LABEL_CLASS = "grid gap-1.5 text-sm text-slate-300"

export const PRIMARY_BUTTON =
  "hv-solid-action inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"

export const SECONDARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"

export const ROW_ACTION =
  "inline-flex h-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"

export const SECTION_CLASS =
  "hv-elevated-section overflow-clip rounded-xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)]"

export const TABLE_HEAD_ROW =
  "[&>th]:whitespace-nowrap [&>th]:py-2.5 [&>th]:text-[10.5px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.14em]"

/** GET/POST/PATCH/DELETE against this app's API; returns { ok, status, data, error }. */
export async function apiRequest(path, searchParams, { method = "GET", body } = {}) {
  try {
    const res = await fetch(buildAuthUrl(path, searchParams), {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data: json?.data ?? null, error: json?.error ?? null }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: { code: "NETWORK_ERROR", message: error instanceof Error ? error.message : "Network error" },
    }
  }
}

export function StatusPill({ status }) {
  const active = status !== "INACTIVE"
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
        active ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-800/60 text-slate-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-slate-500"}`} aria-hidden="true" />
      {formatLabel(status)}
    </span>
  )
}

/** Assignment status of one employee's assessment invite. */
export function assignmentLabel(inviteStatus, attemptStatus) {
  if (inviteStatus === "COMPLETED" || attemptStatus === "SUBMITTED" || attemptStatus === "TIMED_OUT") return "Completed"
  if (inviteStatus === "CANCELLED") return "Cancelled"
  if (attemptStatus === "IN_PROGRESS" || inviteStatus === "IN_PROGRESS") return "In progress"
  if (inviteStatus === "OPENED") return "Opened"
  return "Pending"
}

/** `expired` comes from the server (link past its expiry). */
export function AssignmentPill({ inviteStatus, attemptStatus, expired = false }) {
  let label = assignmentLabel(inviteStatus, attemptStatus)
  if (expired && label !== "Completed" && label !== "Cancelled") {
    label = "Expired"
  }
  const tone =
    label === "Completed"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : label === "Expired" || label === "Cancelled"
        ? "border-slate-700 bg-slate-800/60 text-slate-400"
        : label === "In progress" || label === "Opened"
          ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>
}

export function ResultPill({ passed }) {
  if (passed === null || passed === undefined) return <span className="text-slate-500">-</span>
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
        passed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"
      }`}
    >
      {passed ? "Passed" : "Failed"}
    </span>
  )
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-"
  return `${Math.round(Number(value))}%`
}

export function Pagination({ meta, onPage, label = "results" }) {
  if (!meta || meta.total === 0) return null
  const from = (meta.page - 1) * meta.pageSize + 1
  const to = Math.min(meta.total, meta.page * meta.pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-xs text-slate-400 lg:px-5">
      <span className="tabular-nums">
        {from}–{to} of {meta.total} {label}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={ROW_ACTION} disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Previous
        </button>
        <span className="tabular-nums">
          Page {meta.page} of {meta.totalPages}
        </span>
        <button type="button" className={ROW_ACTION} disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}

const SECTION_TABS = [
  { href: "/employees", label: "Employees", key: "employees" },
  { href: "/employees/departments", label: "Departments", key: "departments" },
  { href: "/employees/projects", label: "Projects", key: "projects" },
]

/**
 * Page header + setup guide + Employees / Departments / Projects tabs, shared
 * by the three sections. Bump `flowRefreshKey` after a change so the guide's
 * progress updates.
 */
export function EmployeesSectionHeader({ active, title, description, searchParams, actions, flowRefreshKey = 0 }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <header className="min-w-0 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Employee Development</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">{title}</h1>
          {description ? <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p> : null}
        </header>
        {actions ? <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div> : null}
      </div>
      <EmployeeFlowGuide refreshKey={flowRefreshKey} />
      <nav aria-label="Employees sections" className="inline-flex w-fit rounded-xl border border-slate-800 bg-slate-900/80 p-1 shadow-sm">
        {SECTION_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={buildAuthUrl(tab.href, searchParams)}
            aria-current={active === tab.key ? "page" : undefined}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              active === tab.key ? "hv-solid-action bg-cyan-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/** Centered modal shell matching the existing dialogs. */
/**
 * Numbered section card inside a modal, matching the Send Interview dialogs'
 * FormStep so every form in the dashboard reads the same way.
 */
export function FormSection({ number, title, hint, aside = null, children }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-cyan-400/15 text-xs font-semibold text-cyan-200"
          >
            {number}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {hint ? <p className="mt-0.5 text-xs leading-5 text-slate-400">{hint}</p> : null}
          </div>
        </div>
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** Field label with a red asterisk for required fields. */
export function FieldLabel({ children, required = false }) {
  return (
    <span className="text-sm text-slate-300">
      {children}
      {required ? <span className="ml-0.5 text-rose-300" aria-hidden="true">*</span> : null}
    </span>
  )
}

/*
 * Header and footer stay fixed while the body scrolls, and the card is capped
 * to the viewport: without this, a tall form (Add employee) ran past the end
 * of the dialog because the dashboard caps [aria-modal] children's height.
 */
export function ModalShell({ open, onClose, busy = false, labelledBy, eyebrow, title, description, icon = null, children, footer, footerNote = null, maxWidth = "max-w-lg" }) {
  useEffect(() => {
    if (!open) return undefined
    const handleEscape = (event) => {
      if (event.key === "Escape" && !busy) onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, busy, onClose])

  if (!open) return null
  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-sm sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div className={`hv-theme-modal flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-[24px] border border-slate-700/70 bg-[#0a1020] text-white shadow-[0_30px_80px_rgba(2,6,23,0.55)] sm:max-h-[calc(100dvh-5rem)]`}>
        <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),transparent_45%)] px-6 py-5">
          <div className="flex min-w-0 items-start gap-3.5">
            {icon ? (
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10 text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.14)]">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">{eyebrow}</p> : null}
              <h2 id={labelledBy} className="mt-1 text-xl font-semibold tracking-tight text-white">
                {title}
              </h2>
              {description ? <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-none rounded-full border border-slate-700/80 bg-slate-900/80 px-3 py-1 text-sm text-slate-300 transition hover:border-cyan-300/60 hover:text-white disabled:opacity-60"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
        {footer ? (
          <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/40 px-6 py-4">
            <p className="text-xs text-slate-500">{footerNote}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
