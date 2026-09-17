"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import FeatureLockedNotice from "@/components/FeatureLockedNotice"
import Navbar from "@/components/Navbar"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDate } from "@/lib/client/date-format"
import { showActionFeedback } from "@/lib/client/action-feedback"

const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-400/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]"

const DEFAULT_FORM = { fullName: "", email: "", department: "", title: "" }

function statusTone(status) {
  return status === "INACTIVE"
    ? "border-slate-700 bg-slate-800/60 text-slate-400"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
}

/**
 * Deliberately minimal: list + create/edit + active/inactive toggle. This is
 * the Employee Assessments/Challenges/Tasks MVP's Employees page, not an
 * HRMS — no payroll/attendance/leave/reviews here.
 */
export default function EmployeesPage() {
  const searchParams = useAuthSearchParams()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [openCreate, setOpenCreate] = useState(false)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [lockedFeature, setLockedFeature] = useState(null)

  const loadEmployees = () => {
    setLoading(true)
    fetch(buildAuthUrl("/api/employees?pageSize=100", searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.error?.code === "FEATURE_NOT_IN_PLAN") {
          setLockedFeature(data.error.entitlement || "EMPLOYEE_ACTIVITIES")
          return
        }

        setEmployees(Array.isArray(data?.data?.employees) ? data.data.employees : [])
      })
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadEmployees()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      setOpenCreate(false)
      loadEmployees()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Save failed", message: err instanceof Error ? err.message : "Something went wrong" })
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (employee) => {
    const nextStatus = employee.status === "INACTIVE" ? "ACTIVE" : "INACTIVE"
    try {
      const res = await fetch(buildAuthUrl(`/api/employees/${employee.id}`, searchParams), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) throw new Error("Failed to update status")
      loadEmployees()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Update failed", message: err instanceof Error ? err.message : "Something went wrong" })
    }
  }

  if (lockedFeature) {
    return <FeatureLockedNotice feature={lockedFeature} />
  }

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-violet-300/75">Employee Development</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Employees</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Manage the employees in your organization, then assign them Assessments, Challenges, and Tasks from{" "}
              <Link href={buildAuthUrl("/assessments", searchParams)} className="text-violet-300 underline-offset-4 hover:underline">
                Assessment
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
            <button
              onClick={() => setOpenCreate(true)}
              className="rounded-full bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(167,139,250,0.35)] transition hover:bg-violet-500"
            >
              Add Employee
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-800 bg-slate-900/40">
          <div className="hv-table-scroll">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-950/20 text-slate-400">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Name</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Email</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Department</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Title</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Added</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-slate-400">Loading employees...</td>
                  </tr>
                ) : employees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-slate-400">No employees yet. Add one to get started.</td>
                  </tr>
                ) : (
                  employees.map((employee) => (
                    <tr key={employee.id} className="border-t border-slate-800/80 text-slate-200">
                      <td className="px-4 py-3">
                        <Link
                          href={buildAuthUrl(`/employees/${employee.id}`, searchParams)}
                          className="font-medium text-white underline-offset-4 hover:text-violet-200 hover:underline"
                        >
                          {employee.fullName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{employee.email}</td>
                      <td className="px-4 py-3 text-slate-400">{employee.department ?? "-"}</td>
                      <td className="px-4 py-3 text-slate-400">{employee.title ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${statusTone(employee.status)}`}>
                          {employee.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{formatDate(employee.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={buildAuthUrl(`/employees/${employee.id}`, searchParams)}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 transition hover:text-white"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => toggleStatus(employee)}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 transition hover:text-white"
                          >
                            {employee.status === "INACTIVE" ? "Reactivate" : "Deactivate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {openCreate && (
        <div
          className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="hv-theme-modal relative w-full max-w-lg overflow-hidden rounded-[28px] border border-violet-500/20 bg-[#0a1020]/95 text-white shadow-[0_0_60px_rgba(139,92,246,0.18)]">
            <div className="relative p-6">
              <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
                <h2 className="text-xl font-semibold tracking-tight text-white">Add Employee</h2>
                <button
                  onClick={() => setOpenCreate(false)}
                  className="rounded-full border border-slate-700/80 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-violet-400/60 hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Full Name</label>
                  <input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className={FIELD_CLASS} />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Email</label>
                  <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={FIELD_CLASS} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Department</label>
                    <input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} className={FIELD_CLASS} />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Title</label>
                    <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={FIELD_CLASS} />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-800/80 pt-5">
                <button onClick={() => setOpenCreate(false)} className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 transition hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="rounded-full bg-violet-500/90 px-5 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(167,139,250,0.35)] transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Add Employee"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
