"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import AddEmployeeModal from "@/components/AddEmployeeModal"
import FeatureLockedNotice from "@/components/FeatureLockedNotice"
import Navbar from "@/components/Navbar"
import {
  EmployeesSectionHeader,
  FIELD_CLASS,
  PRIMARY_BUTTON,
  Pagination,
  ROW_ACTION,
  SECTION_CLASS,
  StatusPill,
  TABLE_HEAD_ROW,
  apiRequest,
} from "@/components/employees/shared"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { showActionFeedback } from "@/lib/client/action-feedback"

const PAGE_SIZE = 25

/**
 * Employees register: search, Department / Project / Status filters and
 * server-side pagination, so large organizations never load everyone into
 * the browser. Deliberately not an HRMS — no payroll/attendance/leave here.
 */
export default function EmployeesPage() {
  const searchParams = useAuthSearchParams()
  const [employees, setEmployees] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lockedFeature, setLockedFeature] = useState(null)
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [departmentId, setDepartmentId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [status, setStatus] = useState("")
  const [filtersReady, setFiltersReady] = useState(false)
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [flowKey, setFlowKey] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, departmentId, projectId, status])

  useEffect(() => {
    // ?departmentId= / ?projectId= pre-set the filters, so other pages can link to a filtered view.
    const url = new URL(window.location.href)
    setDepartmentId(url.searchParams.get("departmentId") ?? "")
    setProjectId(url.searchParams.get("projectId") ?? "")
    // ?add=1 (from the setup guide) opens the Add Employee form straight away.
    if (url.searchParams.get("add") === "1") setFormOpen(true)
    setFiltersReady(true)
    apiRequest("/api/departments", searchParams).then((res) => setDepartments(res.data?.departments ?? []))
    apiRequest("/api/projects", searchParams).then((res) => setProjects(res.data?.projects ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadEmployees = useCallback(() => {
    if (!filtersReady) return
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedSearch) params.set("search", debouncedSearch)
    if (departmentId) params.set("departmentId", departmentId)
    if (projectId) params.set("projectId", projectId)
    if (status) params.set("status", status)

    apiRequest(`/api/employees?${params.toString()}`, searchParams)
      .then((res) => {
        if (res.error?.code === "FEATURE_NOT_IN_PLAN") {
          setLockedFeature(res.error.entitlement || "EMPLOYEE_ACTIVITIES")
          return
        }
        setEmployees(res.data?.employees ?? [])
        setMeta(res.data?.meta ?? null)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersReady, page, debouncedSearch, departmentId, projectId, status])

  useEffect(() => {
    loadEmployees()
  }, [loadEmployees])

  const toggleStatus = async (employee) => {
    const nextStatus = employee.status === "INACTIVE" ? "ACTIVE" : "INACTIVE"
    const res = await apiRequest(`/api/employees/${employee.id}`, searchParams, { method: "PATCH", body: { status: nextStatus } })
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Update failed", message: res.error?.message || "Failed to update status" })
      return
    }
    showActionFeedback({
      tone: "success",
      title: nextStatus === "ACTIVE" ? "Employee reactivated" : "Employee deactivated",
      message:
        nextStatus === "ACTIVE"
          ? employee.fullName
          : `${employee.fullName} won't be included in new assessment assignments. Past results are kept.`,
    })
    loadEmployees()
    setFlowKey((key) => key + 1)
  }

  if (lockedFeature) {
    return <FeatureLockedNotice feature={lockedFeature} />
  }

  const filtersActive = Boolean(debouncedSearch || departmentId || projectId || status)
  const emptyMessage = loading
    ? "Loading employees..."
    : employees.length === 0
      ? filtersActive
        ? "No employees match these filters."
        : "No employees yet. Add one to get started."
      : null

  const renderProjects = (employee) =>
    employee.projects?.length ? (
      <div className="flex flex-wrap gap-1">
        {employee.projects.slice(0, 2).map((project) => (
          <span key={project.id} className="rounded-md border border-slate-700 bg-slate-800/50 px-1.5 py-0.5 text-[11px] text-slate-300">
            {project.name}
          </span>
        ))}
        {employee.projects.length > 2 ? (
          <span className="text-[11px] text-slate-500" title={employee.projects.map((p) => p.name).join(", ")}>
            +{employee.projects.length - 2}
          </span>
        ) : null}
      </div>
    ) : (
      <span className="text-slate-500">-</span>
    )

  const renderActions = (employee) => (
    <div className="flex items-center justify-end gap-2">
      <Link href={buildAuthUrl(`/employees/${employee.id}`, searchParams)} className={ROW_ACTION}>
        View
      </Link>
      <button
        type="button"
        className={ROW_ACTION}
        onClick={() => {
          setEditing(employee)
          setFormOpen(true)
        }}
      >
        Edit
      </button>
      <button type="button" className={ROW_ACTION} onClick={() => toggleStatus(employee)}>
        {employee.status === "INACTIVE" ? "Reactivate" : "Deactivate"}
      </button>
    </div>
  )

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <EmployeesSectionHeader
          active="employees"
          title="Employees"
          description="Your organization's employees, their departments and projects. Assign them Assessments, Challenges and Tasks by person, department or project."
          searchParams={searchParams}
          flowRefreshKey={flowKey}
          actions={
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
              className={PRIMARY_BUTTON}
            >
              <span aria-hidden="true" className="text-base leading-none">+</span>
              Add Employee
            </button>
          }
        />

        <section aria-label="Employees" className={SECTION_CLASS}>
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-5">
            <div>
              <h2 className="text-base font-semibold text-white">All employees</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {loading && !meta ? "Loading..." : `${meta?.total ?? 0} ${meta?.total === 1 ? "employee" : "employees"}`}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, email, ID or designation"
                aria-label="Search employees"
                className={`${FIELD_CLASS} h-9 text-[13px] sm:col-span-2 lg:w-72`}
              />
              <select aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={`${FIELD_CLASS} h-9 text-[13px] lg:w-44`}>
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${FIELD_CLASS} h-9 text-[13px] lg:w-44`}>
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${FIELD_CLASS} h-9 text-[13px] lg:w-36`}>
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          {/* Table from lg up; cards below. */}
          <div className="hv-table-scroll hidden lg:block">
            <table className="w-full min-w-[1080px] text-[13px]">
              <thead className="bg-slate-950 text-slate-500 shadow-[0_1px_0_var(--color-slate-800)]">
                <tr className={TABLE_HEAD_ROW}>
                  <th className="pl-5 pr-3 text-left">Employee ID</th>
                  <th className="px-3 text-left">Employee</th>
                  <th className="px-3 text-left">Email</th>
                  <th className="px-3 text-left">Department</th>
                  <th className="px-3 text-left">Projects</th>
                  <th className="px-3 text-left">Designation</th>
                  <th className="px-3 text-left">Status</th>
                  <th className="pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {emptyMessage ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-slate-400">{emptyMessage}</td>
                  </tr>
                ) : (
                  employees.map((employee) => (
                    <tr key={employee.id} className="border-t border-slate-800/80 align-middle text-slate-200 transition-colors first:border-t-0 hover:bg-slate-800/25">
                      <td className="truncate py-3 pl-5 pr-3 font-mono text-xs text-slate-400">{employee.employeeCode ?? "-"}</td>
                      <td className="px-3 py-3">
                        <Link
                          href={buildAuthUrl(`/employees/${employee.id}`, searchParams)}
                          className="block truncate font-semibold text-white underline-offset-4 hover:text-cyan-200 hover:underline"
                        >
                          {employee.fullName}
                        </Link>
                      </td>
                      <td className="truncate px-3 py-3 text-slate-400">{employee.email}</td>
                      <td className="truncate px-3 py-3 text-slate-300">{employee.departmentInfo?.name ?? employee.department ?? "-"}</td>
                      <td className="px-3 py-3">{renderProjects(employee)}</td>
                      <td className="truncate px-3 py-3 text-slate-400">{employee.title ?? "-"}</td>
                      <td className="px-3 py-3">
                        <StatusPill status={employee.status} />
                      </td>
                      <td className="py-3 pl-3 pr-5">{renderActions(employee)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {emptyMessage ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400 lg:hidden">{emptyMessage}</p>
          ) : (
            <ul className="lg:hidden" aria-label="Employees">
              {employees.map((employee) => (
                <li key={employee.id} className="border-t border-slate-800/80 px-4 py-4 first:border-t-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={buildAuthUrl(`/employees/${employee.id}`, searchParams)} className="block truncate text-sm font-semibold text-white hover:text-cyan-200">
                        {employee.fullName}
                      </Link>
                      <p className="truncate text-xs text-slate-400">{employee.email}</p>
                    </div>
                    <StatusPill status={employee.status} />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {[employee.employeeCode, employee.departmentInfo?.name ?? employee.department, employee.title].filter(Boolean).join(" · ") || "-"}
                  </p>
                  <div className="mt-2">{renderProjects(employee)}</div>
                  <div className="mt-3 border-t border-slate-800/80 pt-3">{renderActions(employee)}</div>
                </li>
              ))}
            </ul>
          )}

          <Pagination meta={meta} onPage={setPage} label="employees" />
        </section>
      </main>

      <AddEmployeeModal
        open={formOpen}
        employee={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          loadEmployees()
          setFlowKey((key) => key + 1)
        }}
      />
    </div>
  )
}
