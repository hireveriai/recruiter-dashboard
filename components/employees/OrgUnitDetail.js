"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import Navbar from "@/components/Navbar"
import EmployeePicker from "@/components/employees/EmployeePicker"
import OrgUnitFormModal, { ORG_UNIT_KINDS } from "@/components/employees/OrgUnitFormModal"
import {
  FIELD_CLASS,
  ModalShell,
  PRIMARY_BUTTON,
  Pagination,
  ROW_ACTION,
  SECONDARY_BUTTON,
  SECTION_CLASS,
  StatusPill,
  TABLE_HEAD_ROW,
  apiRequest,
} from "@/components/employees/shared"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { showActionFeedback } from "@/lib/client/action-feedback"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

const PAGE_SIZE = 25

/**
 * One department or project and its employees. Projects additionally let the
 * recruiter add and remove members (an employee can be on many projects);
 * department membership is changed from the employee's own form, since each
 * employee has exactly one primary department.
 */
export default function OrgUnitDetail({ kind, id }) {
  const searchParams = useAuthSearchParams()
  const config = ORG_UNIT_KINDS[kind]
  const isProject = kind === "project"
  const [unit, setUnit] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [employees, setEmployees] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [status, setStatus] = useState("ACTIVE")
  const [page, setPage] = useState(1)
  const [editOpen, setEditOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [picked, setPicked] = useState({})
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => setPage(1), [debounced, status])

  const loadUnit = useCallback(() => {
    apiRequest(`${config.api}/${id}`, searchParams).then((res) => {
      if (res.ok) setUnit(res.data)
      else setNotFound(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadEmployees = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    params.set(isProject ? "projectId" : "departmentId", id)
    if (debounced) params.set("search", debounced)
    if (status) params.set("status", status)
    apiRequest(`/api/employees?${params.toString()}`, searchParams)
      .then((res) => {
        setEmployees(res.data?.employees ?? [])
        setMeta(res.data?.meta ?? null)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page, debounced, status])

  useEffect(() => {
    loadUnit()
  }, [loadUnit])
  useEffect(() => {
    loadEmployees()
  }, [loadEmployees])

  const memberIds = useMemo(() => new Set(employees.map((employee) => employee.id)), [employees])

  const toggleStatus = async () => {
    const nextStatus = unit.status === "INACTIVE" ? "ACTIVE" : "INACTIVE"
    const res = await apiRequest(`${config.api}/${id}`, searchParams, { method: "PATCH", body: { status: nextStatus } })
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Update failed", message: res.error?.message || "Something went wrong" })
      return
    }
    setUnit(res.data)
  }

  const addMembers = async () => {
    const employeeIds = Object.keys(picked)
    if (employeeIds.length === 0) return
    setAdding(true)
    const res = await apiRequest(`${config.api}/${id}/members`, searchParams, { method: "POST", body: { employeeIds } })
    setAdding(false)
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Add failed", message: res.error?.message || "Failed to add employees" })
      return
    }
    showActionFeedback({
      tone: "success",
      title: "Employees added",
      message: `${res.data.added} added${res.data.alreadyMembers ? `, ${res.data.alreadyMembers} already on ${unit?.name}` : ""}.`,
    })
    setPicked({})
    setAddOpen(false)
    loadUnit()
    loadEmployees()
  }

  const removeMember = async (employee) => {
    const res = await apiRequest(`${config.api}/${id}/members?employeeId=${employee.id}`, searchParams, { method: "DELETE" })
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Remove failed", message: res.error?.message || "Failed to remove employee" })
      return
    }
    showActionFeedback({
      tone: "success",
      title: "Removed from project",
      message: `${employee.fullName} was removed from ${unit?.name}. Their assessment history is unchanged.`,
    })
    loadUnit()
    loadEmployees()
  }

  const emptyMessage = loading
    ? "Loading employees..."
    : employees.length === 0
      ? debounced || status
        ? "No employees match these filters."
        : `No employees ${isProject ? "on this project" : "in this department"} yet.`
      : null

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <header className="min-w-0 max-w-3xl">
            <Link href={buildAuthUrl(config.path, searchParams)} className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300 hover:text-cyan-200">
              &larr; {config.plural}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
                {unit?.name ?? (notFound ? `${config.label} not found` : "Loading...")}
              </h1>
              {unit?.code ? <span className="rounded-md border border-slate-700 px-2 py-0.5 font-mono text-xs text-slate-400">{unit.code}</span> : null}
              {unit ? <StatusPill status={unit.status} /> : null}
            </div>
            {unit?.description ? <p className="mt-1 text-sm leading-6 text-slate-400">{unit.description}</p> : null}
            {unit ? (
              <p className="mt-2 text-sm text-slate-300">
                <span className="font-semibold text-white tabular-nums">{unit.activeEmployeeCount}</span> active{" "}
                {unit.activeEmployeeCount === 1 ? "employee" : "employees"}
                {unit.employeeCount > unit.activeEmployeeCount ? (
                  <span className="text-slate-500"> · {unit.employeeCount - unit.activeEmployeeCount} inactive</span>
                ) : null}
              </p>
            ) : null}
          </header>
          {unit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setEditOpen(true)}>
                Edit
              </button>
              <button type="button" className={SECONDARY_BUTTON} onClick={toggleStatus}>
                {unit.status === "INACTIVE" ? "Activate" : "Deactivate"}
              </button>
              {isProject ? (
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  disabled={unit.status === "INACTIVE"}
                  title={unit.status === "INACTIVE" ? "Activate this project to add employees" : undefined}
                  onClick={() => setAddOpen(true)}
                >
                  + Add Employees
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {unit?.status === "INACTIVE" ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            This {config.label.toLowerCase()} is inactive: it can&apos;t be targeted by new assessments or take new members.
            Existing assignments and results are kept.
          </p>
        ) : null}

        <section aria-label="Employees" className={SECTION_CLASS}>
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-5">
            <h2 className="text-base font-semibold text-white">Employees</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employees"
                aria-label="Search employees"
                className={`${FIELD_CLASS} h-9 text-[13px] sm:w-60`}
              />
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${FIELD_CLASS} h-9 text-[13px] sm:w-36`}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="">All statuses</option>
              </select>
            </div>
          </div>
          <div className="hv-table-scroll">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="bg-slate-950 text-slate-500 shadow-[0_1px_0_var(--color-slate-800)]">
                <tr className={TABLE_HEAD_ROW}>
                  <th className="pl-5 pr-3 text-left">Employee ID</th>
                  <th className="px-3 text-left">Employee</th>
                  <th className="px-3 text-left">Email</th>
                  <th className="px-3 text-left">{isProject ? "Department" : "Projects"}</th>
                  <th className="px-3 text-left">Designation</th>
                  <th className="px-3 text-left">Status</th>
                  <th className="pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {emptyMessage ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-slate-400">{emptyMessage}</td>
                  </tr>
                ) : (
                  employees.map((employee) => (
                    <tr key={employee.id} className="border-t border-slate-800/80 text-slate-200 first:border-t-0 hover:bg-slate-800/25">
                      <td className="py-3 pl-5 pr-3 font-mono text-xs text-slate-400">{employee.employeeCode ?? "-"}</td>
                      <td className="px-3 py-3">
                        <Link href={buildAuthUrl(`/employees/${employee.id}`, searchParams)} className="font-semibold text-white hover:text-cyan-200">
                          {employee.fullName}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-slate-400">{employee.email}</td>
                      <td className="px-3 py-3 text-slate-300">
                        {isProject
                          ? employee.departmentInfo?.name ?? employee.department ?? "-"
                          : employee.projects?.map((p) => p.name).join(", ") || "-"}
                      </td>
                      <td className="px-3 py-3 text-slate-400">{employee.title ?? "-"}</td>
                      <td className="px-3 py-3">
                        <StatusPill status={employee.status} />
                      </td>
                      <td className="py-3 pl-3 pr-5">
                        <div className="flex justify-end gap-2">
                          <Link href={buildAuthUrl(`/employees/${employee.id}`, searchParams)} className={ROW_ACTION}>
                            View
                          </Link>
                          {isProject ? (
                            <button type="button" className={ROW_ACTION} onClick={() => removeMember(employee)}>
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination meta={meta} onPage={setPage} label="employees" />
        </section>
      </main>

      <OrgUnitFormModal
        kind={kind}
        open={editOpen}
        unit={unit}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          loadUnit()
          loadEmployees()
        }}
      />

      {isProject ? (
        <ModalShell
          open={addOpen}
          onClose={() => !adding && setAddOpen(false)}
          busy={adding}
          labelledBy="add-members-title"
          eyebrow="Projects"
          title={`Add employees to ${unit?.name ?? "project"}`}
          description="Employees can be on several projects; adding them here doesn't change their other projects or department."
          maxWidth="max-w-xl"
          footer={
            <>
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setAddOpen(false)} disabled={adding}>
                Cancel
              </button>
              <button type="button" className={PRIMARY_BUTTON} onClick={addMembers} disabled={adding || Object.keys(picked).length === 0}>
                {adding ? "Adding..." : `Add ${Object.keys(picked).length || ""} ${Object.keys(picked).length === 1 ? "employee" : "employees"}`}
              </button>
            </>
          }
        >
          <EmployeePicker selected={picked} onChange={setPicked} excludeIds={memberIds} />
        </ModalShell>
      ) : null}
    </div>
  )
}
