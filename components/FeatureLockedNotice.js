"use client";

import Link from "next/link";

import BackToDashboardLink from "@/components/BackToDashboardLink";
import Navbar from "@/components/Navbar";
import { buildAuthUrl } from "@/lib/client/auth-query";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";

const FEATURE_LABELS = {
  ASSESSMENT: "VERIS Assessment",
  SCREENING: "VERIS Screening",
  AI_INTERVIEW: "VERIS AI Interview",
  EMPLOYEE_ACTIVITIES: "Employee Activities",
};

/**
 * Shown in place of a page's normal content when its primary data fetch
 * comes back with the FEATURE_NOT_IN_PLAN error code from
 * lib/server/entitlements.ts's assertEntitlement — i.e. the org's
 * subscription doesn't include this module. This is the page-level half of
 * "don't just hide the nav link, also block direct URL access": the API
 * already refuses the request server-side (403), this component just turns
 * that refusal into an intentional screen instead of a blank/broken page.
 */
export default function FeatureLockedNotice({ feature }) {
  const searchParams = useAuthSearchParams();
  const label = FEATURE_LABELS[feature] || "This feature";

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-6 py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-blue-300/75">Not included in your plan</p>
        <h1 className="text-3xl font-semibold tracking-tight text-white">{label} isn&apos;t part of your current plan</h1>
        <p className="text-sm leading-6 text-slate-400">
          Your organization hasn&apos;t purchased {label} yet. Upgrade your subscription to unlock it for your workspace.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={buildAuthUrl("/billing", searchParams)}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            View plans
          </Link>
          <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>
      </main>
    </div>
  );
}
