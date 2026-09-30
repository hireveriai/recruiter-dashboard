"use client"

import { useEffect, useMemo, useState } from "react"

import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"
import { showActionFeedback } from "@/lib/client/action-feedback"
import {
  FIELD_CLASS,
  FieldLabel,
  FormSection,
  LABEL_CLASS,
  ModalShell,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  apiRequest,
} from "@/components/employees/shared"

const EMPTY_FORM = {
  employeeCode: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  title: "",
  departmentId: "",
  projectIds: [],
  managerUserId: "",
  joiningDate: "",
  status: "ACTIVE",
}

function formFromEmployee(employee) {
  if (!employee) return EMPTY_FORM
  return {
    employeeCode: employee.employeeCode ?? "",
    firstName: employee.firstName ?? employee.fullName ?? "",
    lastName: employee.lastName ?? "",
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    title: employee.title ?? "",
    departmentId: employee.departmentId ?? "",
    projectIds: (employee.projects ?? []).map((project) => project.id),
    managerUserId: employee.managerUserId ?? "",
    joiningDate: employee.joiningDate ? String(employee.joiningDate).slice(0, 10) : "",
    status: employee.status ?? "ACTIVE",
  }
}

/**
 * Add or edit an employee. Shared by the Employees pages and the Assessments
 * page (so employees can be added where employee assessments are created).
 * Pass `employee` to edit; omit it to add.
 */
export default function AddEmployeeModal({ open, onClose, onSaved, employee = null }) {
  const searchParams = useAuthSearchParams()
  const isEdit = Boolean(employee)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [managers, setManagers] = useState([])

  useEffect(() => {
    if (!open) return
    setForm(formFromEmployee(employee))
    Promise.all([
      apiRequest("/api/departments", searchParams),
      apiRequest("/api/projects", searchParams),
      apiRequest("/api/employees/managers", searchParams),
    ]).then(([departmentRes, projectRes, managerRes]) => {
      setDepartments(departmentRes.data?.departments ?? [])
      setProjects(projectRes.data?.projects ?? [])
      setManagers(managerRes.data?.managers ?? [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee])

  // Inactive departments/projects can't take new people, but an employee
  // already in one keeps seeing it selected.
  const departmentOptions = useMemo(
    () => departments.filter((d) => d.status === "ACTIVE" || d.id === employee?.departmentId),
    [departments, employee]
  )
  const currentProjectIds = useMemo(() => new Set((employee?.projects ?? []).map((p) => p.id)), [employee])
  const projectOptions = useMemo(
    () => projects.filter((p) => p.status === "ACTIVE" || currentProjectIds.has(p.id)),
    [projects, currentProjectIds]
  )

  // Inline "+ New department / + New project": creates it on the spot and
  // selects it, so a first-time user isn't sent away to another page.
  const [quickCreate, setQuickCreate] = useState(null) // "department" | "project" | null
  const [quickName, setQuickName] = useState("")
  const [quickSaving, setQuickSaving] = useState(false)

  const submitQuickCreate = async () => {
    const name = quickName.trim()
    if (!name || !quickCreate) return
    setQuickSaving(true)
    const res = await apiRequest(quickCreate === "department" ? "/api/departments" : "/api/projects", searchParams, {
      method: "POST",
      body: { name },
    })
    setQuickSaving(false)
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Couldn't create it", message: res.error?.message || "Something went wrong" })
      return
    }
    if (quickCreate === "department") {
      setDepartments((current) => [...current, res.data])
      setForm((current) => ({ ...current, departmentId: res.data.id }))
    } else {
      setProjects((current) => [...current, res.data])
      setForm((current) => ({ ...current, projectIds: [...current.projectIds, res.data.id] }))
    }
    showActionFeedback({ tone: "success", title: `${quickCreate === "department" ? "Department" : "Project"} created`, message: res.data.name })
    setQuickCreate(null)
    setQuickName("")
  }

  const renderQuickCreate = (kind) =>
    quickCreate === kind ? (
      <div className="mt-2 flex gap-2">
        <input
          value={quickName}
          onChange={(event) => setQuickName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submitQuickCreate()
            }
          }}
          placeholder={kind === "department" ? "e.g. Engineering" : "e.g. Project Alpha"}
          aria-label={`New ${kind} name`}
          className={FIELD_CLASS}
          autoFocus
        />
        <button type="button" onClick={submitQuickCreate} disabled={quickSaving || !quickName.trim()} className={PRIMARY_BUTTON}>
          {quickSaving ? "..." : "Add"}
        </button>
        <button type="button" onClick={() => setQuickCreate(null)} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => {
          setQuickCreate(kind)
          setQuickName("")
        }}
        className="mt-1.5 w-fit text-xs font-semibold text-cyan-300 hover:text-cyan-200"
      >
        + New {kind}
      </button>
    )

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const toggleProject = (projectId) =>
    setForm((current) => ({
      ...current,
      projectIds: current.projectIds.includes(projectId)
        ? current.projectIds.filter((id) => id !== projectId)
        : [...current.projectIds, projectId],
    }))

  const handleClose = () => {
    if (!saving) onClose()
  }

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.email.trim()) {
      showActionFeedback({ tone: "error", title: "Missing details", message: "First name and email are required." })
      return
    }

    const body = {
      employeeCode: form.employeeCode.trim() || null,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim() || null,
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      title: form.title.trim() || null,
      departmentId: form.departmentId || null,
      projectIds: form.projectIds,
      managerUserId: form.managerUserId || null,
      joiningDate: form.joiningDate || null,
      status: form.status,
    }

    setSaving(true)
    const res = await apiRequest(isEdit ? `/api/employees/${employee.id}` : "/api/employees", searchParams, {
      method: isEdit ? "PATCH" : "POST",
      body,
    })
    setSaving(false)

    if (!res.ok) {
      showActionFeedback({
        tone: "error",
        title: "Save failed",
        message: res.error?.message || (isEdit ? "Failed to update employee" : "Failed to add employee"),
      })
      return
    }

    showActionFeedback({
      tone: "success",
      title: isEdit ? "Employee updated" : "Employee added",
      message: res.data?.fullName ?? `${body.firstName} ${body.lastName ?? ""}`.trim(),
    })
    onClose()
    onSaved?.(res.data ?? null)
  }

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      busy={saving}
      labelledBy="employee-form-title"
      eyebrow="Employees"
      title={isEdit ? "Edit employee" : "Add employee"}
      description={isEdit ? "Update their details, team and reporting line." : "They can then be assigned employee assessments, challenges and tasks."}
      icon={
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="8" r="3.5" />
          <path d="M3.5 20a6.5 6.5 0 0 1 13 0" />
          <path d="M19 8v6M16 11h6" />
        </svg>
      }
      maxWidth="max-w-3xl"
      footerNote={
        <>
          <span className="text-rose-300">*</span> Required
        </>
      }
      footer={
        <>
          <button type="button" onClick={handleClose} disabled={saving} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={PRIMARY_BUTTON}>
            {saving ? "Saving..." : isEdit ? "Save changes" : "Add employee"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormSection number={1} title="Who they are" hint="Assessment invitations are sent to this email.">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={LABEL_CLASS}>
              <FieldLabel required>First name</FieldLabel>
              <input value={form.firstName} onChange={update("firstName")} placeholder="e.g. Priya" className={FIELD_CLASS} autoFocus />
            </label>
            <label className={LABEL_CLASS}>
              <FieldLabel>Last name</FieldLabel>
              <input value={form.lastName} onChange={update("lastName")} placeholder="e.g. Sharma" className={FIELD_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              <FieldLabel required>Work email</FieldLabel>
              <input type="email" value={form.email} onChange={update("email")} placeholder="name@company.com" className={FIELD_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              <FieldLabel>Employee ID</FieldLabel>
              <input value={form.employeeCode} onChange={update("employeeCode")} placeholder="e.g. EMP-1024" className={FIELD_CLASS} />
            </label>
          </div>
        </FormSection>

        <FormSection number={2} title="Role" hint="Optional details that help you find and group people later.">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={LABEL_CLASS}>
              <FieldLabel>Designation</FieldLabel>
              <input value={form.title} onChange={update("title")} placeholder="e.g. Software Engineer" className={FIELD_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              <FieldLabel>Phone</FieldLabel>
              <input type="tel" value={form.phone} onChange={update("phone")} placeholder="+91 98765 43210" className={FIELD_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              <FieldLabel>Joining date</FieldLabel>
              <input type="date" value={form.joiningDate} onChange={update("joiningDate")} className={FIELD_CLASS} />
            </label>
            <div className={LABEL_CLASS}>
              <FieldLabel>Status</FieldLabel>
              <div role="radiogroup" aria-label="Status" className="grid h-10 grid-cols-2 gap-1 rounded-xl border border-slate-700 bg-slate-950/60 p-1">
                {[
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Inactive" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={form.status === option.value}
                    onClick={() => setForm((current) => ({ ...current, status: option.value }))}
                    className={`rounded-lg text-sm font-medium transition ${
                      form.status === option.value
                        ? option.value === "ACTIVE"
                          ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30"
                          : "bg-slate-700/60 text-white ring-1 ring-slate-500/40"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {form.status === "INACTIVE" ? <span className="text-xs text-slate-500">Inactive employees are excluded from new assignments.</span> : null}
            </div>
          </div>
        </FormSection>

        <FormSection
          number={3}
          title="Team & reporting"
          hint="Assign assessments to a whole department or project, and choose which manager sees this employee's results."
          aside={<span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Optional</span>}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={LABEL_CLASS}>
              <label htmlFor="employee-department">
                <FieldLabel>Department</FieldLabel>
              </label>
              <select id="employee-department" value={form.departmentId} onChange={update("departmentId")} className={FIELD_CLASS}>
                <option value="">{departmentOptions.length ? "No department" : "No departments yet"}</option>
                {departmentOptions.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                    {department.status === "INACTIVE" ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
              {renderQuickCreate("department")}
            </div>

            <div className={LABEL_CLASS}>
              <label htmlFor="employee-manager">
                <FieldLabel>Manager</FieldLabel>
              </label>
              <select id="employee-manager" value={form.managerUserId} onChange={update("managerUserId")} className={FIELD_CLASS}>
                <option value="">{managers.length ? "No manager" : "No team members found"}</option>
                {managers.map((manager) => (
                  <option key={manager.userId} value={manager.userId}>
                    {manager.fullName || manager.email}
                    {manager.fullName ? ` · ${manager.email}` : ""}
                  </option>
                ))}
              </select>
              <span className="text-xs leading-5 text-slate-500">From your workspace team. Managers review their direct reports&apos; results.</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel>Projects</FieldLabel>
              <span className="text-xs text-slate-500">{form.projectIds.length ? `${form.projectIds.length} selected` : "An employee can be on several"}</span>
            </div>
            {projectOptions.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-slate-700 px-3 py-3 text-xs text-slate-500">No projects yet. Create one below.</p>
            ) : (
              <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {projectOptions.map((project) => {
                  const selected = form.projectIds.includes(project.id)
                  return (
                    <button
                      key={project.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleProject(project.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                        selected
                          ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
                          : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500 hover:text-white"
                      }`}
                    >
                      {selected ? (
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : null}
                      {project.name}
                      {project.code ? <span className="text-slate-500">· {project.code}</span> : null}
                      {project.status === "INACTIVE" ? <span className="text-slate-500">(inactive)</span> : null}
                    </button>
                  )
                })}
              </div>
            )}
            {renderQuickCreate("project")}
          </div>
        </FormSection>
      </div>
    </ModalShell>
  )
}
