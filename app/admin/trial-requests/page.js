"use client"

import { useCallback, useEffect, useState } from "react"

import { formatLabel } from "@/lib/client/format-label"

const STATUS_TABS = [
  { key: "PENDING_REVIEW", label: "Pending review" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
]

const RISK_STYLES = {
  LOW: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  MEDIUM: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  HIGH: "border-rose-400/30 bg-rose-500/10 text-rose-200",
}

function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleString()
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm text-slate-200">{value || "—"}</p>
    </div>
  )
}

export default function AdminTrialRequestsPage() {
  const [status, setStatus] = useState("PENDING_REVIEW")
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/admin/trial-requests?status=${status}`, {
        credentials: "include",
        cache: "no-store",
      })
      const payload = await response.json()

      if (response.status === 403) {
        setForbidden(true)
        return
      }

      if (!response.ok || !payload?.success) {
        setError(payload?.error?.message || "Unable to load trial requests.")
        return
      }

      setForbidden(false)
      setRequests(payload.data.requests ?? [])
    } catch (loadError) {
      console.warn("Trial request load failed", loadError)
      setError("Unable to load trial requests.")
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    load()
  }, [load])

  const decide = useCallback(
    async (requestId, decision) => {
      if (busyId) return
      setBusyId(requestId)
      setError(null)

      try {
        const response = await fetch(`/api/admin/trial-requests/${requestId}/decision`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        })
        const payload = await response.json()

        if (!response.ok || !payload?.success) {
          setError(payload?.error?.message || "The decision could not be recorded.")
          return
        }

        await load()
      } catch (decisionError) {
        console.warn("Trial decision failed", decisionError)
        setError("The decision could not be recorded.")
      } finally {
        setBusyId(null)
      }
    },
    [busyId, load]
  )

  if (forbidden) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-white">Restricted</h1>
        <p className="mt-3 text-sm text-slate-400">
          Trial review is limited to platform administrators.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Platform admin</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Free entitlement requests</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Approving a recruiter trial grants exactly 10 AI interviews and 25 VERIS screenings to the organization.
          Approving a candidate request grants exactly one practice interview. Approving twice is a no-op.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatus(tab.key)}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
              status === tab.key
                ? "border-blue-500 bg-blue-600/20 text-white"
                : "border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <p className="mt-4 text-sm text-amber-300">{error}</p> : null}

      {loading ? (
        <p className="mt-8 text-sm text-slate-400">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="mt-8 text-sm text-slate-400">Nothing here.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {requests.map((request) => (
            <article
              key={request.requestId}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {request.requestType === "RECRUITER_TRIAL" ? "Recruiter trial" : "Candidate practice"}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    {request.companyName || request.organizationName || request.contactEmail || "Unknown requester"}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-lg border px-3 py-1 text-xs font-semibold ${
                      RISK_STYLES[request.riskLevel] || RISK_STYLES.LOW
                    }`}
                  >
                    Risk {request.riskLevel} · {request.riskScore}
                  </span>
                  <span className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300">
                    {formatLabel(request.status)}
                  </span>
                  {request.granted ? (
                    <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                      Granted
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Email" value={request.contactEmail} />
                <Field label="Email domain" value={request.emailDomain} />
                <Field label="Website" value={request.companyWebsite} />
                <Field label="Email verified" value={request.emailVerified ? "Yes" : "No"} />
                <Field label="Requested" value={formatDate(request.requestedAt)} />
                <Field label="Decided" value={formatDate(request.decidedAt)} />
                <Field label="Decided by" value={request.decidedBy} />
                <Field label="Auto decision" value={request.autoDecision ? "Yes" : "No"} />
              </div>

              {request.riskReasons?.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {request.riskReasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-lg border border-slate-700 bg-slate-950/50 px-2.5 py-1 text-[11px] text-slate-300"
                    >
                      {formatLabel(reason)}
                    </span>
                  ))}
                </div>
              ) : null}

              {request.status === "PENDING_REVIEW" ? (
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busyId === request.requestId}
                    onClick={() => decide(request.requestId, "APPROVE")}
                    className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyId === request.requestId ? "Working…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === request.requestId}
                    onClick={() => decide(request.requestId, "REJECT")}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
