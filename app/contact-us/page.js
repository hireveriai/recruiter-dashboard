"use client";

import { useEffect, useMemo, useState } from "react";
import BackToDashboardLink from "@/components/BackToDashboardLink";

const fallbackCategories = [
  { value: "TECHNICAL_ISSUE", label: "Technical Issue" },
  { value: "INTERVIEW_RECORDING_ISSUE", label: "Interview Recording Issue" },
  { value: "AI_ANALYSIS_ISSUE", label: "AI Analysis Issue" },
  { value: "BILLING_SUBSCRIPTION", label: "Billing & Subscription" },
  { value: "ACCESS_PERMISSIONS", label: "Access & Permissions" },
  { value: "SECURITY_CONCERN", label: "Security Concern" },
  { value: "ENTERPRISE_SALES", label: "Enterprise Sales" },
  { value: "COMPLIANCE_REQUEST", label: "Compliance Request" },
];

const fallbackConfig = {
  sidebar: [{ label: "Support Desk", value: "support@hireveri.com" }],
  system_status: [
    { label: "Platform Operational", value: "Live" },
    { label: "AI Systems Active", value: "Active" },
    { label: "Recording Infrastructure Healthy", value: "Healthy" },
  ],
  sla: [
    { label: "Critical", value: "<2 Hours" },
    { label: "Standard", value: "<24 Hours" },
    { label: "Enterprise Priority Routing", value: "Included" },
  ],
};

const priorities = ["Critical", "High", "Standard", "Low"];

const initialForm = {
  fullName: "",
  workEmail: "",
  organization: "",
  priority: "Standard",
  category: fallbackCategories[0].value,
  message: "",
  attachment: null,
};

function FieldLabel({ children, required = true }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
      {children} {required ? <span className="text-cyan-300">*</span> : null}
    </label>
  );
}

function StatusPill({ item }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
        <span className="truncate text-sm font-medium text-slate-100">{item.label}</span>
      </div>
      <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">{item.value}</span>
    </div>
  );
}

export default function ContactUsPage() {
  const [form, setForm] = useState(initialForm);
  const [categories, setCategories] = useState(fallbackCategories);
  const [config, setConfig] = useState(fallbackConfig);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSupportData() {
      try {
        const response = await fetch("/api/support", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok || payload?.success === false) {
          return;
        }

        if (isMounted) {
          setCategories(payload.data?.categories?.length ? payload.data.categories : fallbackCategories);
          setConfig({ ...fallbackConfig, ...(payload.data?.config || {}) });
          setForm((current) => ({
            ...current,
            category: current.category || payload.data?.categories?.[0]?.value || fallbackCategories[0].value,
          }));
        }
      } catch {
        if (isMounted) {
          setForm((current) => ({ ...current, category: current.category || fallbackCategories[0].value }));
        }
      }
    }

    loadSupportData();

    return () => {
      isMounted = false;
    };
  }, []);

  const selectedCategoryLabel = useMemo(
    () => categories.find((category) => category.value === form.category)?.label || "Support Request",
    [categories, form.category]
  );

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setSuccess(null);

    try {
      const formData = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key === "attachment") {
          if (value) formData.append(key, value);
          return;
        }

        formData.append(key, value);
      });

      const response = await fetch("/api/support", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error?.message || "Unable to submit support request.");
      }

      setSuccess(payload.data);
      setForm({ ...initialForm, category: categories[0]?.value || fallbackCategories[0].value });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit support request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="hv-preserve-dark min-h-screen overflow-x-hidden bg-[#050b16] text-white">
      <section className="relative px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(14,165,233,0.08)_1px,transparent_1px),linear-gradient(rgba(14,165,233,0.07)_1px,transparent_1px)] bg-[size:54px_54px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,0.18),transparent_48%)]" />

        <div className="relative mx-auto grid w-full max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 rounded-[28px] border border-cyan-300/10 bg-slate-950/78 p-5 shadow-[0_28px_110px_rgba(2,6,23,0.58)] backdrop-blur sm:p-7 lg:p-8">
            <div className="flex flex-col gap-4 border-b border-slate-800/90 pb-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:bg-slate-900 hover:text-white" />
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.32em] text-cyan-200/80">HireVeri Support Center</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
                  Enterprise Operations Support
                </h1>
                <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  Route technical, recording, AI analysis, security, billing, sales, and compliance requests directly into the HireVeri support queue.
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-3 text-sm text-cyan-100">
                <span className="block text-xs uppercase tracking-[0.2em] text-cyan-300/70">Active Channel</span>
                <span className="mt-1 block font-semibold">{selectedCategoryLabel}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-7 grid gap-5">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel>Full Name</FieldLabel>
                  <input className="h-12 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10" value={form.fullName} onChange={(event) => updateField("fullName", event.target.value)} placeholder="Jane Operator" required />
                </div>
                <div className="grid gap-2">
                  <FieldLabel>Work Email</FieldLabel>
                  <input type="email" className="h-12 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10" value={form.workEmail} onChange={(event) => updateField("workEmail", event.target.value)} placeholder="jane@company.com" required />
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel>Organization</FieldLabel>
                  <input className="h-12 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10" value={form.organization} onChange={(event) => updateField("organization", event.target.value)} placeholder="Acme Talent Operations" required />
                </div>
                <div className="grid gap-2">
                  <FieldLabel>Priority</FieldLabel>
                  <select className="h-12 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 text-sm text-white outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10" value={form.priority} onChange={(event) => updateField("priority", event.target.value)} required>
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-2">
                <FieldLabel>Category</FieldLabel>
                <select className="h-12 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 text-sm text-white outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10" value={form.category} onChange={(event) => updateField("category", event.target.value)} required>
                  {categories.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <FieldLabel>Message</FieldLabel>
                <textarea className="min-h-40 resize-y rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10" value={form.message} onChange={(event) => updateField("message", event.target.value)} placeholder="Describe the impacted workflow, users, timestamps, interview IDs, or error state." required />
              </div>

              <div className="grid gap-2">
                <FieldLabel required={false}>Optional Attachment</FieldLabel>
                <input type="file" className="w-full rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-3 text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-cyan-300 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-950 hover:border-cyan-300/60" onChange={(event) => updateField("attachment", event.target.files?.[0] || null)} />
              </div>

              {error ? (
                <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
              ) : null}
              {success ? (
                <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  Request received. Reference ID: <span className="font-semibold tracking-wide">{success.referenceId}</span>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-slate-800/90 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-slate-500">Our support team will review your request and respond by email.</p>
                <button type="submit" disabled={isSubmitting} className="h-12 shrink-0 rounded-2xl bg-cyan-300 px-6 text-sm font-bold text-slate-950 shadow-[0_16px_42px_rgba(34,211,238,0.18)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">
                  {isSubmitting ? "Routing Request..." : "Submit Support Request"}
                </button>
              </div>
            </form>
          </div>

          <aside className="grid min-w-0 gap-5 xl:sticky xl:top-6 xl:self-start">
            <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5 shadow-[0_24px_90px_rgba(2,6,23,0.45)] backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Enterprise Support</p>
              <div className="mt-4 grid gap-3">
                {(config.sidebar || fallbackConfig.sidebar).map((item) => (
                  <a key={`${item.label}-${item.value}`} href={`mailto:${item.value}`} className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-4 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/40">
                    <span className="block text-xs uppercase tracking-[0.18em] text-cyan-300/60">{item.label}</span>
                    <span className="mt-1 block break-words">{item.value}</span>
                  </a>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5 shadow-[0_24px_90px_rgba(2,6,23,0.45)] backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">System Status</p>
              <div className="mt-4 grid gap-3">
                {(config.system_status || fallbackConfig.system_status).map((item) => (
                  <StatusPill key={`${item.label}-${item.value}`} item={item} />
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5 shadow-[0_24px_90px_rgba(2,6,23,0.45)] backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">SLA Routing</p>
              <div className="mt-4 grid gap-3">
                {(config.sla || fallbackConfig.sla).map((item) => (
                  <div key={`${item.label}-${item.value}`} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    <span className="block text-sm font-semibold text-slate-100">{item.label}</span>
                    <span className="mt-1 block text-sm text-cyan-200">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
