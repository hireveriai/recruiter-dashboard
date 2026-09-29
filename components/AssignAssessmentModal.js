"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import EmployeePicker from "@/components/employees/EmployeePicker"
import {
  FIELD_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON,
  ROW_ACTION,
  SECONDARY_BUTTON,
  apiRequest,
} from "@/components/employees/shared"
import { showActionFeedback } from "@/lib/client/action-feedback"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

const TARGET_TYPES = [
  { value: "INDIVIDUAL", label: "Individual Employees", hint: "Pick people one by one" },
  { value: "DEPARTMENT", label: "Department", hint: "Everyone active in a department" },
  { value: "PROJECT", label: "Project", hint: "Everyone active on a project" },
  { value: "DEPARTMENT_PROJECT", label: "Department + Project", hint: "People in both" },
]
const TYPE_LABEL = Object.fromEntries(TARGET_TYPES.map((t) => [t.value, t.label]))
const PREVIEW_PAGE_SIZE = 10

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function Section({ step, title, children }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-cyan-400/15 text-xs font-semibold text-cyan-200">
          {step}
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-slate-800/80 py-2 first:border-t-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-semibold text-white">{value}</dd>
    </div>
  )
}

/**
 * Assign a published employee assessment to individual employees, a
 * department, a project, or a department + project combination. The
 * recipient count, the already-assigned count and the employee list all come
 * from the server (POST .../targeting/preview), so a 5,000-person department
 * is never loaded into the browser. Sending (POST .../assign) skips anyone
 * who already has this assessment.
 */
export default function AssignAssessmentModal({ open, assessment, onClose, onAssigned }) {
  const searchParams = useAuthSearchParams()
  const [targetType, setTargetType] = useState("DEPARTMENT")
  const [departmentId, setDepartmentId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [picked, setPicked] = useState({})
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showEmployees, setShowEmployees] = useState(false)
  const [previewPage, setPreviewPage] = useState(1)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    setTargetType("DEPARTMENT")
    setDepartmentId("")
    setProjectId("")
    setPicked({})
    setPreview(null)
    setPreviewError(null)
    setShowEmployees(false)
    setPreviewPage(1)
    setResult(null)
    apiRequest("/api/departments?status=ACTIVE", searchParams).then((res) => setDepartments(res.data?.departments ?? []))
    apiRequest("/api/projects?status=ACTIVE", searchParams).then((res) => setProjects(res.data?.projects ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assessment?.id])

  useEffect(() => {
    if (!open) return undefined
    const handleEscape = (event) => {
      if (event.key === "Escape" && !sending) onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, sending, onClose])

  const pickedIds = useMemo(() => Object.keys(picked), [picked])

  // The target as the API expects it, or null while incomplete.
  const target = useMemo(() => {
    if (targetType === "INDIVIDUAL") return pickedIds.length ? { targetType, employeeIds: pickedIds } : null
    if (targetType === "DEPARTMENT") return departmentId ? { targetType, departmentId } : null
    if (targetType === "PROJECT") return projectId ? { targetType, projectId } : null
    return departmentId && projectId ? { targetType, departmentId, projectId } : null
  }, [targetType, departmentId, projectId, pickedIds])
  const targetKey = JSON.stringify(target)

  useEffect(() => {
    setPreviewPage(1)
  }, [targetKey])

  useEffect(() => {
    if (!open || !assessment?.id || !target) {
      requestSeq.current += 1
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return undefined
    }
    const seq = ++requestSeq.current
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      apiRequest(`/api/assessments/${assessment.id}/targeting/preview`, searchParams, {
        method: "POST",
        body: { target, page: previewPage, pageSize: PREVIEW_PAGE_SIZE },
      }).then((res) => {
        if (seq !== requestSeq.current) return
        setPreviewLoading(false)
        if (res.ok) {
          setPreview(res.data)
          setPreviewError(null)
        } else {
          setPreview(null)
          setPreviewError(res.error?.message || "Could not calculate recipients")
        }
      })
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assessment?.id, targetKey, previewPage])

  if (!open || !assessment) return null

  const handleSend = async () => {
    if (!target || !preview?.canSend) return
    setSending(true)
    const res = await apiRequest(`/api/assessments/${assessment.id}/assign`, searchParams, { method: "POST", body: { target } })
    setSending(false)
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Assignment failed", message: res.error?.message || "Failed to assign assessment" })
      return
    }
    setResult(res.data)
    showActionFeedback({
      tone: "success",
      title: "Assessment assigned",
      message: `${plural(res.data.assigned, "employee", "employees")} assigned${
        res.data.alreadyAssigned ? `, ${res.data.alreadyAssigned} already had it` : ""
      }.`,
    })
    onAssigned?.(res.data)
  }

  const counts = preview?.counts

  const renderTargetInputs = () => {
    if (targetType === "INDIVIDUAL") {
      return <EmployeePicker selected={picked} onChange={setPicked} heightClass="max-h-60" />
    }
    const showDepartment = targetType === "DEPARTMENT" || targetType === "DEPARTMENT_PROJECT"
    const showProject = targetType === "PROJECT" || targetType === "DEPARTMENT_PROJECT"
    return (
      <div className={`grid gap-4 ${showDepartment && showProject ? "sm:grid-cols-2" : ""}`}>
        {showDepartment ? (
          <label className={LABEL_CLASS}>
            Department
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={FIELD_CLASS}>
              <option value="">Select a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.activeEmployeeCount})
                </option>
              ))}
            </select>
            {departments.length === 0 ? <span className="text-xs text-slate-500">No active departments yet.</span> : null}
          </label>
        ) : null}
        {showProject ? (
          <label className={LABEL_CLASS}>
            Project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={FIELD_CLASS}>
              <option value="">Select a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.code ? ` · ${p.code}` : ""} ({p.activeEmployeeCount})
                </option>
              ))}
            </select>
            {projects.length === 0 ? <span className="text-xs text-slate-500">No active projects yet.</span> : null}
          </label>
        ) : null}
      </div>
    )
  }

  const renderRecipients = () => {
    if (!target) {
      return (
        <p className="text-sm text-slate-400">
          {targetType === "INDIVIDUAL"
            ? "Select at least one employee."
            : targetType === "DEPARTMENT_PROJECT"
              ? "Select a department and a project. Only employees in both will receive the assessment."
              : `Select a ${targetType === "DEPARTMENT" ? "department" : "project"}.`}
        </p>
      )
    }
    if (previewError) {
      return <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{previewError}</p>
    }
    if (!preview) {
      return <p className="text-sm text-slate-400">Calculating recipients...</p>
    }

    return (
      <div className={`space-y-4 ${previewLoading ? "opacity-70" : ""}`} aria-live="polite">
        <dl className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-1">
          <Fact label="Assignment Type" value={TYPE_LABEL[preview.target.targetType]} />
          {preview.target.department ? <Fact label="Department" value={preview.target.department.name} /> : null}
          {preview.target.project ? <Fact label="Project" value={preview.target.project.name} /> : null}
          <Fact label="Eligible Employees" value={<span className="tabular-nums">{counts.matched}</span>} />
        </dl>

        {counts.alreadyAssigned > 0 ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              [counts.matched, "matched"],
              [counts.alreadyAssigned, "already assigned"],
              [counts.newAssignments, "new"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-2">
                <p className="text-lg font-semibold tabular-nums text-white">{value}</p>
                <p className="text-[11px] text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        ) : null}

        {preview.selection && (preview.selection.inactive || preview.selection.notFound) ? (
          <p className="text-xs text-amber-200">
            {preview.selection.inactive ? `${plural(preview.selection.inactive, "selected employee is", "selected employees are")} inactive and will be skipped. ` : ""}
            {preview.selection.notFound ? `${plural(preview.selection.notFound, "selection was", "selections were")} not found.` : ""}
          </p>
        ) : null}

        <p className={`text-base font-semibold ${preview.canSend ? "text-cyan-100" : "text-slate-300"}`}>
          {preview.canSend
            ? `${plural(counts.newAssignments, "employee", "employees")} will receive this assessment.`
            : preview.sendBlockedReason}
        </p>
        {counts.alreadyCompleted > 0 ? (
          <p className="-mt-2 text-xs text-slate-400">
            {plural(counts.alreadyCompleted, "matching employee has", "matching employees have")} already completed it and won&apos;t be re-sent.
          </p>
        ) : null}

        {counts.matched > 0 ? (
          <div>
            <button type="button" className={ROW_ACTION} onClick={() => setShowEmployees((v) => !v)} aria-expanded={showEmployees}>
              {showEmployees ? "Hide Employees" : "View Employees"}
            </button>
            {showEmployees ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-800">
                <ul className="divide-y divide-slate-800/80">
                  {preview.employees.map((employee) => (
                    <li key={employee.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-white">{employee.fullName}</span>
                        <span className="block truncate text-xs text-slate-400">
                          {[employee.employeeCode, employee.department, employee.email].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {employee.alreadyAssigned ? (
                        <span className="flex-none rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-400">
                          {employee.assignmentStatus === "COMPLETED" ? "Completed" : "Already assigned"}
                        </span>
                      ) : (
                        <span className="flex-none rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">New</span>
                      )}
                    </li>
                  ))}
                </ul>
                {preview.meta.totalPages > 1 ? (
                  <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-400">
                    <span>
                      Page {preview.meta.page} of {preview.meta.totalPages}
                    </span>
                    <div className="flex gap-2">
                      <button type="button" className={ROW_ACTION} disabled={previewPage <= 1} onClick={() => setPreviewPage((p) => p - 1)}>
                        Previous
                      </button>
                      <button
                        type="button"
                        className={ROW_ACTION}
                        disabled={previewPage >= preview.meta.totalPages}
                        onClick={() => setPreviewPage((p) => p + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const renderResult = () => (
    <div className="space-y-4" aria-live="polite">
      <section className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.08] p-4 sm:p-5">
        <p className="text-sm font-semibold text-white">
          {result.assigned > 0
            ? `${plural(result.assigned, "employee", "employees")} assigned ${assessment.title}.`
            : "Nobody new to assign — everyone matching already has this assessment."}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {result.target.label} · {result.matched} matched · {result.alreadyAssigned} already assigned
        </p>
      </section>
      {result.assigned > 0 ? (
        result.emailsFailed > 0 ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
            {plural(result.emailsFailed, "invitation email", "invitation emails")} could not be sent
            {result.emailError ? ` (${result.emailError})` : ""}. The assignments were still created
            {result.failedRecipients?.length ? `; affected: ${result.failedRecipients.join(", ")}` : ""}.
          </div>
        ) : (
          <p className="text-sm text-slate-300">{plural(result.emailsSent, "invitation email was", "invitation emails were")} sent.</p>
        )
      ) : null}
      {result.creditWarning ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">{result.creditWarning}</div>
      ) : null}
    </div>
  )

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-3 py-3 backdrop-blur-md sm:items-center sm:px-4 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-assessment-title"
    >
      <div className="hv-theme-modal relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-slate-700/70 bg-[#0a1020]/95 text-white shadow-[0_30px_80px_rgba(2,6,23,0.55)] sm:max-h-[calc(100dvh-3rem)]">
        <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Assign Assessment</p>
            <h2 id="assign-assessment-title" className="mt-1 truncate text-xl font-semibold tracking-tight text-white">
              {assessment.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="flex-none rounded-full border border-slate-700/80 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-cyan-300/60 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
          {result ? (
            renderResult()
          ) : (
            <>
              <Section step={1} title="Assign Assessment To">
                <div role="radiogroup" aria-label="Assign assessment to" className="grid gap-2 sm:grid-cols-2">
                  {TARGET_TYPES.map((type) => (
                    <label
                      key={type.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                        targetType === type.value
                          ? "border-cyan-400/50 bg-cyan-500/10"
                          : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                      }`}
                    >
                      <input
                        type="radio"
                        name="assign-target-type"
                        value={type.value}
                        checked={targetType === type.value}
                        onChange={() => setTargetType(type.value)}
                        className="mt-1 h-4 w-4 accent-cyan-500"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-white">{type.label}</span>
                        <span className="block text-xs text-slate-400">{type.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Section>

              <Section
                step={2}
                title={
                  targetType === "INDIVIDUAL"
                    ? "Select employees"
                    : targetType === "DEPARTMENT_PROJECT"
                      ? "Select department and project"
                      : targetType === "DEPARTMENT"
                        ? "Select department"
                        : "Select project"
                }
              >
                {renderTargetInputs()}
              </Section>

              <Section step={3} title="Assessment Recipients">
                {renderRecipients()}
              </Section>
            </>
          )}
        </div>

        <div className="flex flex-none items-center justify-end gap-2 border-t border-slate-800 px-5 py-4 sm:px-7">
          {result ? (
            <button type="button" className={PRIMARY_BUTTON} onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className={SECONDARY_BUTTON} onClick={onClose} disabled={sending}>
                Cancel
              </button>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                onClick={handleSend}
                disabled={sending || previewLoading || !preview?.canSend}
              >
                {sending
                  ? "Sending..."
                  : preview?.canSend
                    ? `Send Assessment to ${plural(counts.newAssignments, "Employee", "Employees")}`
                    : "Send Assessment"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
