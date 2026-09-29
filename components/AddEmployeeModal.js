"use client"

import { useEffect, useMemo, useState } from "react"

import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"
import { showActionFeedback } from "@/lib/client/action-feedback"
import {
  FIELD_CLASS,
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
      description={isEdit ? undefined : "They can then be assigned employee assessments, challenges and tasks."}
      maxWidth="max-w-2xl"
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
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL_CLASS}>
          First name
          <input value={form.firstName} onChange={update("firstName")} className={FIELD_CLASS} autoFocus />
        </label>
        <label className={LABEL_CLASS}>
          Last name
          <input value={form.lastName} onChange={update("lastName")} className={FIELD_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          Email
          <input type="email" value={form.email} onChange={update("email")} className={FIELD_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          Employee ID
          <input value={form.employeeCode} onChange={update("employeeCode")} placeholder="Optional, e.g. EMP-1024" className={FIELD_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          Designation
          <input value={form.title} onChange={update("title")} placeholder="e.g. Software Engineer" className={FIELD_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          Phone
          <input type="tel" value={form.phone} onChange={update("phone")} placeholder="Optional" className={FIELD_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          Department
          <select value={form.departmentId} onChange={update("departmentId")} className={FIELD_CLASS}>
            <option value="">No department</option>
            {departmentOptions.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
                {department.status === "INACTIVE" ? " (inactive)" : ""}
              </option>
            ))}
          </select>
          {departments.length === 0 ? (
            <span className="text-xs text-slate-500">Create departments under Employees → Departments.</span>
          ) : null}
        </label>
        <label className={LABEL_CLASS}>
          Manager
          <select value={form.managerUserId} onChange={update("managerUserId")} className={FIELD_CLASS}>
            <option value="">No manager</option>
            {managers.map((manager) => (
              <option key={manager.userId} value={manager.userId}>
                {manager.fullName || manager.email}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          Joining date
          <input type="date" value={form.joiningDate} onChange={update("joiningDate")} className={FIELD_CLASS} />
        </label>
        <label className={LABEL_CLASS}>
          Status
          <select value={form.status} onChange={update("status")} className={FIELD_CLASS}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm text-slate-300">
          Projects <span className="text-xs text-slate-500">({form.projectIds.length} selected)</span>
        </legend>
        {projectOptions.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No projects yet. Create them under Employees → Projects.</p>
        ) : (
          <div className="mt-2 grid max-h-44 gap-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/40 p-2 sm:grid-cols-2">
            {projectOptions.map((project) => (
              <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-800/50">
                <input
                  type="checkbox"
                  checked={form.projectIds.includes(project.id)}
                  onChange={() => toggleProject(project.id)}
                  className="h-4 w-4 accent-cyan-500"
                />
                <span className="truncate">
                  {project.name}
                  {project.code ? <span className="text-slate-500"> · {project.code}</span> : null}
                  {project.status === "INACTIVE" ? <span className="text-slate-500"> (inactive)</span> : null}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </ModalShell>
  )
}
