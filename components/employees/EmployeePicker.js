"use client"

import { useEffect, useState } from "react"

import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"
import { FIELD_CLASS, apiRequest } from "@/components/employees/shared"

const PAGE_SIZE = 20

/**
 * Search-and-tick employee selector. Searches on the server (active
 * employees only) and shows one page at a time; the selection is kept by the
 * parent as { [id]: { id, fullName, email } } so it survives new searches.
 * `excludeIds` hides people who shouldn't be offered (e.g. current members).
 */
export default function EmployeePicker({ selected, onChange, excludeIds = null, heightClass = "max-h-72" }) {
  const searchParams = useAuthSearchParams()
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ status: "ACTIVE", page: "1", pageSize: String(PAGE_SIZE) })
    if (debounced) params.set("search", debounced)
    apiRequest(`/api/employees?${params.toString()}`, searchParams).then((res) => {
      if (cancelled) return
      setResults(res.data?.employees ?? [])
      setTotal(res.data?.meta?.total ?? 0)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const visible = excludeIds ? results.filter((employee) => !excludeIds.has(employee.id)) : results
  const selectedList = Object.values(selected)

  const toggle = (employee) => {
    const next = { ...selected }
    if (next[employee.id]) {
      delete next[employee.id]
    } else {
      next[employee.id] = { id: employee.id, fullName: employee.fullName, email: employee.email }
    }
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search employees..."
        aria-label="Search employees"
        className={FIELD_CLASS}
        autoFocus
      />
      <div className={`${heightClass} overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/40 p-1.5`}>
        {loading && results.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500">Searching...</p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500">
            {debounced ? "No active employees match this search." : "No active employees yet. Add them under Employees first."}
          </p>
        ) : (
          visible.map((employee) => (
            <label
              key={employee.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-200 hover:bg-slate-800/50"
            >
              <input
                type="checkbox"
                checked={Boolean(selected[employee.id])}
                onChange={() => toggle(employee)}
                className="h-4 w-4 flex-none accent-cyan-500"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-white">{employee.fullName}</span>
                <span className="block truncate text-xs text-slate-400">
                  {[employee.employeeCode, employee.departmentInfo?.name ?? employee.department, employee.email].filter(Boolean).join(" · ")}
                </span>
              </span>
            </label>
          ))
        )}
        {total > PAGE_SIZE ? (
          <p className="px-2.5 py-2 text-xs text-slate-500">
            Showing the first {PAGE_SIZE} of {total}. Refine the search to find others.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">
          Selected: {selectedList.length} {selectedList.length === 1 ? "Employee" : "Employees"}
        </span>
        {selectedList.slice(0, 6).map((employee) => (
          <button
            key={employee.id}
            type="button"
            onClick={() => toggle(employee)}
            className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-slate-300 hover:border-rose-400/50 hover:text-rose-200"
            title="Remove from selection"
          >
            {employee.fullName} ×
          </button>
        ))}
        {selectedList.length > 6 ? <span>+{selectedList.length - 6} more</span> : null}
        {selectedList.length ? (
          <button type="button" onClick={() => onChange({})} className="text-cyan-300 hover:text-cyan-200">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  )
}
