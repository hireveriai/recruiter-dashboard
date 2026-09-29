"use client"

import { useEffect, useState } from "react"

import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { showActionFeedback } from "@/lib/client/action-feedback"

const FIELD_CLASS =
  "h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"

const DEFAULT_FORM = { fullName: "", email: "", department: "", title: "" }

/**
 * Add Employee, shared by the Employees page and the Assessments page (so
 * employees can be added where employee assessments are created). Same
 * request as before: POST /api/employees with fullName, email, department
 * and title.
 */
export default function AddEmployeeModal({ open, onClose, onSaved }) {
  const searchParams = useAuthSearchParams()
  const [form, setForm] = useState(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return undefined

    const handleEscape = (event) => {
      if (event.key === "Escape" && !saving) onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, saving, onClose])

  if (!open) return null

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const handleCreate = async () => {
    if (!form.fullName.trim() || !form.email.trim()) {
      showActionFeedback({ tone: "error", title: "Missing details", message: "Name and email are required." })
      return
    }

    try {
      setSaving(true)
      const res = await fetch(buildAuthUrl("/api/employees", searchParams), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          department: form.department?.trim() || null,
          title: form.title?.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showActionFeedback({ tone: "error", title: "Save failed", message: data?.error?.message || "Failed to add employee" })
        return
      }
      showActionFeedback({ tone: "success", title: "Employee added", message: form.fullName })
      setForm(DEFAULT_FORM)
      onClose()
      onSaved?.(data?.data ?? null)
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Save failed", message: err instanceof Error ? err.message : "Something went wrong" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-sm sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-employee-title"
    >
      <div className="hv-theme-modal w-full max-w-lg rounded-[20px] border border-slate-700/70 bg-[#0a1020] p-6 text-white shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Employees</p>
        <h2 id="add-employee-title" className="mt-1 text-lg font-semibold text-white">
          Add employee
        </h2>
        <p className="mt-1 text-sm text-slate-400">They can then be assigned employee assessments, challenges and tasks.</p>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm text-slate-300">
            Full name
            <input value={form.fullName} onChange={update("fullName")} className={FIELD_CLASS} autoFocus />
          </label>
          <label className="grid gap-1.5 text-sm text-slate-300">
            Email
            <input type="email" value={form.email} onChange={update("email")} className={FIELD_CLASS} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm text-slate-300">
              Department <span className="sr-only">(optional)</span>
              <input value={form.department} onChange={update("department")} placeholder="Optional" className={FIELD_CLASS} />
            </label>
            <label className="grid gap-1.5 text-sm text-slate-300">
              Title <span className="sr-only">(optional)</span>
              <input value={form.title} onChange={update("title")} placeholder="Optional" className={FIELD_CLASS} />
            </label>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-800 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="hv-solid-action rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Add employee"}
          </button>
        </div>
      </div>
    </div>
  )
}
