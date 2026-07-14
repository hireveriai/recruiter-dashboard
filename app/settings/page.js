"use client";

import { useEffect, useMemo, useState } from "react";

import BackToDashboardLink from "@/components/BackToDashboardLink";
import { useOrgTimezone } from "@/components/OrgTimezoneProvider";
import { buildAuthUrl } from "@/lib/client/auth-query";
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";
import {
  DEFAULT_ORG_TIMEZONE,
  DEFAULT_ORG_TIMEZONE_LABEL,
  ORG_TIMEZONE_OPTIONS,
} from "@/lib/time/constants";
import { formatOrgDateTime } from "@/lib/time";

export default function SettingsPage() {
  const searchParams = useAuthSearchParams();
  const cacheKey = `settings:${searchParams.toString()}`;
  const initialSettings = readSessionJsonCache(cacheKey);
  const { timezone, timezoneLabel, setTimezoneState } = useOrgTimezone();
  const [query, setQuery] = useState("");
  const [selectedTimezone, setSelectedTimezone] = useState(() => initialSettings?.timezone ?? DEFAULT_ORG_TIMEZONE);
  const [selectedLabel, setSelectedLabel] = useState(() => initialSettings?.timezoneLabel ?? DEFAULT_ORG_TIMEZONE_LABEL);
  const [status, setStatus] = useState(() => ({ loading: !initialSettings, saving: false, error: "", notice: "" }));

  useEffect(() => {
    let active = true;
    const cached = readSessionJsonCache(cacheKey);

    if (cached) {
      const cachedTimezone = cached.timezone ?? timezone ?? DEFAULT_ORG_TIMEZONE;
      const cachedLabel = cached.timezoneLabel ?? timezoneLabel ?? DEFAULT_ORG_TIMEZONE_LABEL;
      window.queueMicrotask(() => {
        if (!active) {
          return;
        }

        setSelectedTimezone(cachedTimezone);
        setSelectedLabel(cachedLabel);
        setTimezoneState({ timezone: cachedTimezone, timezoneLabel: cachedLabel });
        setStatus({ loading: false, saving: false, error: "", notice: "" });
      });
    }

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        active = false;
      };
    }

    async function loadSettings() {
      try {
        const response = await fetch(buildAuthUrl("/api/organization/settings", searchParams), {
          credentials: "include",
          cache: "default",
        });
        const payload = await response.json();
        if (!active) return;

        const nextTimezone = payload?.data?.timezone ?? timezone ?? DEFAULT_ORG_TIMEZONE;
        const nextLabel = payload?.data?.timezoneLabel ?? timezoneLabel ?? DEFAULT_ORG_TIMEZONE_LABEL;

        setSelectedTimezone(nextTimezone);
        setSelectedLabel(nextLabel);
        setTimezoneState({ timezone: nextTimezone, timezoneLabel: nextLabel });
        writeSessionJsonCache(cacheKey, {
          timezone: nextTimezone,
          timezoneLabel: nextLabel,
        });
        setStatus({ loading: false, saving: false, error: "", notice: "" });
      } catch {
        if (!active) return;
        setStatus({
          loading: false,
          saving: false,
          error: "Unable to load organization timezone settings.",
          notice: "",
        });
      }
    }

    loadSettings();

    return () => {
      active = false;
    };
  }, [cacheKey, searchParams, setTimezoneState, timezone, timezoneLabel]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return ORG_TIMEZONE_OPTIONS;
    }

    return ORG_TIMEZONE_OPTIONS.filter((option) => {
      const haystack = `${option.label} ${option.value} ${option.badge}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query]);

  async function saveTimezone() {
    setStatus((current) => ({ ...current, saving: true, error: "", notice: "" }));

    try {
      const response = await fetch(buildAuthUrl("/api/organization/settings", searchParams), {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timezone: selectedTimezone,
          timezoneLabel: selectedLabel,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message || payload?.message || "Failed to save timezone.");
      }

      setTimezoneState({
        timezone: payload.data.timezone,
        timezoneLabel: payload.data.timezoneLabel,
      });
      writeSessionJsonCache(cacheKey, {
        timezone: payload.data.timezone,
        timezoneLabel: payload.data.timezoneLabel,
      });
      setStatus({ loading: false, saving: false, error: "", notice: "Organization timezone updated." });
    } catch (error) {
      setStatus({
        loading: false,
        saving: false,
        error: error instanceof Error ? error.message : "Failed to save timezone.",
        notice: "",
      });
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white sm:px-8 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-[0_14px_44px_rgba(2,6,23,0.22)]">
          <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-blue-400/40 hover:bg-slate-900 hover:text-white" />
          <p className="mt-6 text-xs uppercase tracking-[0.35em] text-blue-300/80">Organization Settings</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Timezone</h1>
          <p className="mt-4 max-w-3xl text-base text-slate-300">
            Every audit trail, interview schedule, report, and forensic timeline should render in one organization timezone.
          </p>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-[24px] border border-slate-800 bg-slate-950/40 p-6">
              <label className="mb-2 block text-sm text-slate-300">Search timezones</label>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by city, region, or abbreviation"
                className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-violet-400/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]"
              />

              <div className="mt-4 max-h-[320px] space-y-2 overflow-auto pr-1">
                {filteredOptions.map((option) => {
                  const active = option.value === selectedTimezone;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSelectedTimezone(option.value);
                        setSelectedLabel(option.label);
                      }}
                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                        active
                          ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
                          : "border-slate-800 bg-slate-950/40 text-slate-200 hover:border-slate-700"
                      }`}
                    >
                      <span>
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="mt-1 block text-xs text-slate-400">{option.value}</span>
                      </span>
                      <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
                        {option.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-800 bg-slate-950/40 p-6">
              <p className="text-sm font-medium text-white">Current rendering</p>
              <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-100/80">{selectedLabel}</p>
                <p className="mt-2 text-sm text-slate-300">{selectedTimezone}</p>
                <p className="mt-4 text-lg font-semibold text-white">
                  {formatOrgDateTime(new Date().toISOString(), selectedTimezone)}
                </p>
              </div>

              {status.error ? (
                <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {status.error}
                </p>
              ) : null}

              {status.notice ? (
                <p className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  {status.notice}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void saveTimezone()}
                disabled={status.loading || status.saving}
                className="mt-6 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status.saving ? "Saving..." : "Save Organization Timezone"}
              </button>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
