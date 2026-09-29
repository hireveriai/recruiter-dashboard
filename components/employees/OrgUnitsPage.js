"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import FeatureLockedNotice from "@/components/FeatureLockedNotice"
import Navbar from "@/components/Navbar"
import OrgUnitFormModal, { ORG_UNIT_KINDS } from "@/components/employees/OrgUnitFormModal"
import {
  EmployeesSectionHeader,
  FIELD_CLASS,
  PRIMARY_BUTTON,
  ROW_ACTION,
  SECTION_CLASS,
  StatusPill,
  TABLE_HEAD_ROW,
  apiRequest,
} from "@/components/employees/shared"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { showActionFeedback } from "@/lib/client/action-feedback"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

const DESCRIPTIONS = {
  department:
    "Each employee has one primary department. Target an assessment at a whole department instead of picking people one by one.",
  project:
    "Employees can work on several projects at once. Target an assessment at a project, or at a department and project together.",
}

/** Departments / Projects list: name, active headcount, status, actions. */
export default function OrgUnitsPage({ kind }) {
  const searchParams = useAuthSearchParams()
  const config = ORG_UNIT_KINDS[kind]
  const listKey = kind === "project" ? "projects" : "departments"
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [lockedFeature, setLockedFeature] = useState(null)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    apiRequest(status ? `${config.api}?status=${status}` : config.api, searchParams)
      .then((res) => {
        if (res.error?.code === "FEATURE_NOT_IN_PLAN") {
          setLockedFeature(res.error.entitlement || "EMPLOYEE_ACTIVITIES")
          return
        }
        setUnits(res.data?.[listKey] ?? [])
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    load()
  }, [load])

  const toggleStatus = async (unit) => {
    const nextStatus = unit.status === "INACTIVE" ? "ACTIVE" : "INACTIVE"
    const res = await apiRequest(`${config.api}/${unit.id}`, searchParams, { method: "PATCH", body: { status: nextStatus } })
    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Update failed", message: res.error?.message || "Something went wrong" })
      return
    }
    showActionFeedback({
      tone: "success",
      title: `${config.label} ${nextStatus === "ACTIVE" ? "activated" : "deactivated"}`,
      message:
        nextStatus === "ACTIVE"
          ? unit.name
          : `${unit.name} can no longer be targeted or given new members. Existing assignments and results are kept.`,
    })
    load()
  }

  if (lockedFeature) {
    return <FeatureLockedNotice feature={lockedFeature} />
  }

  const query = search.trim().toLowerCase()
  const visible = query
    ? units.filter((unit) => `${unit.name} ${unit.code ?? ""} ${unit.description ?? ""}`.toLowerCase().includes(query))
    : units
  const emptyMessage = loading
    ? `Loading ${config.plural.toLowerCase()}...`
    : units.length === 0
      ? `No ${config.plural.toLowerCase()} yet. Create one to get started.`
      : visible.length === 0
        ? `No ${config.plural.toLowerCase()} match your search.`
        : null

  const detailHref = (unit) => buildAuthUrl(`${config.path}/${unit.id}`, searchParams)
  const renderActions = (unit) => (
    <div className="flex items-center justify-end gap-2">
      <Link href={detailHref(unit)} className={ROW_ACTION}>
        View
      </Link>
      <button
        type="button"
        className={ROW_ACTION}
        onClick={() => {
          setEditing(unit)
          setFormOpen(true)
        }}
      >
        Edit
      </button>
      <button type="button" className={ROW_ACTION} onClick={() => toggleStatus(unit)}>
        {unit.status === "INACTIVE" ? "Activate" : "Deactivate"}
      </button>
    </div>
  )
  const headcount = (unit) => (
    <span className="tabular-nums">
      <span className="font-semibold text-white">{unit.activeEmployeeCount}</span>{" "}
      <span className="text-slate-400">{unit.activeEmployeeCount === 1 ? "Employee" : "Employees"}</span>
      {unit.employeeCount > unit.activeEmployeeCount ? (
        <span className="text-xs text-slate-500"> (+{unit.employeeCount - unit.activeEmployeeCount} inactive)</span>
      ) : null}
    </span>
  )

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <EmployeesSectionHeader
          active={listKey}
          title={config.plural}
          description={DESCRIPTIONS[kind]}
          searchParams={searchParams}
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
              Create {config.label}
            </button>
          }
        />

        <section aria-label={config.plural} className={SECTION_CLASS}>
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-5">
            <div>
              <h2 className="text-base font-semibold text-white">All {config.plural.toLowerCase()}</h2>
              <p className="mt-0.5 text-xs text-slate-400">{loading ? "Loading..." : `${units.length} total`}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${config.plural.toLowerCase()}`}
                aria-label={`Search ${config.plural.toLowerCase()}`}
                className={`${FIELD_CLASS} h-9 text-[13px] sm:w-60`}
              />
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${FIELD_CLASS} h-9 text-[13px] sm:w-36`}>
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          <div className="hidden md:block">
            <table className="w-full table-fixed text-[13px]">
              <thead className="bg-slate-950 text-slate-500 shadow-[0_1px_0_var(--color-slate-800)]">
                <tr className={TABLE_HEAD_ROW}>
                  <th className="w-[26%] pl-5 pr-3 text-left">{config.label}</th>
                  <th className="px-3 text-left">Description</th>
                  <th className="w-[16%] px-3 text-left">Employees</th>
                  <th className="w-[10%] px-3 text-left">Status</th>
                  <th className="w-[22%] pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {emptyMessage ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-slate-400">{emptyMessage}</td>
                  </tr>
                ) : (
                  visible.map((unit) => (
                    <tr key={unit.id} className="border-t border-slate-800/80 align-middle text-slate-200 transition-colors first:border-t-0 hover:bg-slate-800/25">
                      <td className="py-3 pl-5 pr-3">
                        <Link href={detailHref(unit)} className="block truncate font-semibold text-white underline-offset-4 hover:text-cyan-200 hover:underline">
                          {unit.name}
                        </Link>
                        {unit.code ? <span className="font-mono text-[11px] text-slate-500">{unit.code}</span> : null}
                      </td>
                      <td className="truncate px-3 py-3 text-slate-400" title={unit.description ?? ""}>
                        {unit.description || "-"}
                      </td>
                      <td className="px-3 py-3">{headcount(unit)}</td>
                      <td className="px-3 py-3">
                        <StatusPill status={unit.status} />
                      </td>
                      <td className="py-3 pl-3 pr-5">{renderActions(unit)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {emptyMessage ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400 md:hidden">{emptyMessage}</p>
          ) : (
            <ul className="md:hidden" aria-label={config.plural}>
              {visible.map((unit) => (
                <li key={unit.id} className="border-t border-slate-800/80 px-4 py-4 first:border-t-0">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={detailHref(unit)} className="min-w-0 truncate text-sm font-semibold text-white hover:text-cyan-200">
                      {unit.name}
                      {unit.code ? <span className="ml-1 font-mono text-[11px] font-normal text-slate-500">{unit.code}</span> : null}
                    </Link>
                    <StatusPill status={unit.status} />
                  </div>
                  <p className="mt-1 text-sm">{headcount(unit)}</p>
                  <div className="mt-3 border-t border-slate-800/80 pt-3">{renderActions(unit)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <OrgUnitFormModal kind={kind} open={formOpen} unit={editing} onClose={() => setFormOpen(false)} onSaved={load} />
    </div>
  )
}
