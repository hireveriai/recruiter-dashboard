"use client"

import { useMemo, useState } from "react"

import { formatMinorAmount } from "@/lib/pricing/currency"
import {
  INTRODUCTORY_OFFER_LABEL,
  INTRODUCTORY_OFFER_NOTE,
  getRegularAmountPaise,
} from "@/lib/pricing/introductory-offer"

/**
 * The table shows round numbers. Derived per-unit figures are dropped to whole
 * currency units once they are large enough for decimals to be noise (₹300, not
 * ₹299.98). Below ten units the decimals carry the comparison — in USD a per
 * interview cost of $3.49 vs $2.40 would otherwise both collapse to $3 — so
 * they are kept.
 */
const WHOLE_UNIT_THRESHOLD_MINOR = 1_000

function formatUnitAmount(minorUnits: number, currency: string) {
  const whole = minorUnits >= WHOLE_UNIT_THRESHOLD_MINOR

  return formatMinorAmount(minorUnits, currency, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
}

export type ComparablePlan = {
  id: string
  slug: string
  name: string
  description: string
  amountPaise: number
  currency: string
  interviewSessions: number
  screeningReviews: number
  planType: string
  isPopular: boolean
}

type PlanComparisonProps = {
  interviewPlans: ComparablePlan[]
  screeningPlans: ComparablePlan[]
  selectedPlanSlug: string
  selectedAddonPlanSlug: string
  onSelectPlan: (planSlug: string, addonSlug: string) => void
  disabled?: boolean
  /**
   * Live discount from the applied coupon. The struck-through figure is the
   * real list price the plan is sold at, never an invented anchor — a
   * permanently crossed-out price nobody pays is a misleading price claim.
   */
  discountPercentage?: number
  offerLabel?: string
}

/**
 * Unit economics for one plan, optionally bundled with a screening add-on.
 * Everything is in minor units (paise/cents) until it is formatted, so no
 * rounding creeps into the arithmetic.
 */
function getUnitEconomics(
  plan: ComparablePlan,
  addon: ComparablePlan | null,
  discountPercentage = 0
) {
  const chargedPaise = plan.amountPaise + (addon?.amountPaise ?? 0)
  const discount = Math.min(Math.max(discountPercentage, 0), 100)
  const totalPaise = discount > 0 ? Math.round(chargedPaise * (1 - discount / 100)) : chargedPaise

  /* The struck-through figure is the regular price this plan moves to when the
     introductory period ends. An add-on has no introductory price, so it is
     added at its normal rate on both sides of the comparison. */
  const planRegularPaise = getRegularAmountPaise(plan.slug, plan.currency, plan.amountPaise)
  const regularPaise =
    planRegularPaise === null ? null : planRegularPaise + (addon?.amountPaise ?? 0)

  const interviews = Math.max(plan.interviewSessions, 0)
  const screenings = Math.max(plan.screeningReviews, 0) + (addon?.screeningReviews ?? 0)

  return {
    regularPaise,
    totalPaise,
    savingPaise: regularPaise === null ? 0 : regularPaise - totalPaise,
    discounted: regularPaise !== null && regularPaise > totalPaise,
    interviews,
    screenings,
    regularPerInterviewPaise:
      regularPaise !== null && interviews > 0 ? Math.round(regularPaise / interviews) : null,
    perInterviewPaise: interviews > 0 ? Math.round(totalPaise / interviews) : null,
    perScreeningPaise: screenings > 0 ? Math.round(totalPaise / screenings) : null,
    screeningsPerInterview: interviews > 0 ? screenings / interviews : 0,
  }
}

export default function PlanComparison({
  interviewPlans,
  screeningPlans,
  selectedPlanSlug,
  selectedAddonPlanSlug,
  onSelectPlan,
  disabled = false,
  discountPercentage = 0,
  offerLabel = INTRODUCTORY_OFFER_LABEL,
}: PlanComparisonProps) {
  const [withScreening, setWithScreening] = useState(Boolean(selectedAddonPlanSlug))
  const [addonSlug, setAddonSlug] = useState(selectedAddonPlanSlug || screeningPlans[0]?.slug || "")

  const activeAddon = useMemo(
    () => (withScreening ? screeningPlans.find((plan) => plan.slug === addonSlug) ?? null : null),
    [withScreening, addonSlug, screeningPlans]
  )

  const offerActive = useMemo(
    () => interviewPlans.some((plan) => getRegularAmountPaise(plan.slug, plan.currency, plan.amountPaise) !== null),
    [interviewPlans]
  )

  const rows = useMemo(
    () =>
      interviewPlans.map((plan) => ({
        plan,
        economics: getUnitEconomics(plan, activeAddon, discountPercentage),
      })),
    [interviewPlans, activeAddon, discountPercentage]
  )

  /* The lowest cost per interview is the number a recruiter is really
     comparing on, so it gets called out explicitly. */
  const bestPerInterviewPaise = useMemo(() => {
    const values = rows
      .map((row) => row.economics.perInterviewPaise)
      .filter((value): value is number => typeof value === "number")

    return values.length ? Math.min(...values) : null
  }, [rows])

  if (!interviewPlans.length) {
    return null
  }

  const currency = interviewPlans[0]?.currency ?? "INR"

  function applyAddonChoice(nextWithScreening: boolean, nextAddonSlug: string) {
    setWithScreening(nextWithScreening)
    setAddonSlug(nextAddonSlug)

    // Keep checkout in step with the comparison the recruiter is looking at.
    if (selectedPlanSlug) {
      onSelectPlan(selectedPlanSlug, nextWithScreening ? nextAddonSlug : "")
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-100">Compare plans</p>
            {offerActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-100">
                {offerLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {offerActive
              ? `Struck-through figures are the regular price. ${INTRODUCTORY_OFFER_NOTE} Select any plan to switch your quote.`
              : "Cost per interview is the plan price divided by the interviews it includes. Select any plan to switch your quote."}
          </p>
        </div>

        {screeningPlans.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => applyAddonChoice(false, addonSlug)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                withScreening
                  ? "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600"
                  : "border-blue-400/45 bg-blue-500/10 text-blue-100"
              }`}
            >
              Plan only
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => applyAddonChoice(true, addonSlug || screeningPlans[0].slug)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                withScreening
                  ? "border-blue-400/45 bg-blue-500/10 text-blue-100"
                  : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600"
              }`}
            >
              With VERIS Screening
            </button>

            {withScreening ? (
              <select
                value={addonSlug}
                disabled={disabled}
                onChange={(event) => applyAddonChoice(true, event.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 outline-none transition focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {screeningPlans.map((plan) => (
                  <option key={plan.id} value={plan.slug}>
                    {plan.name} · +{plan.screeningReviews} reviews · {formatUnitAmount(plan.amountPaise, plan.currency)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </div>

      {activeAddon ? (
        <p className="mt-3 rounded-lg border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs leading-5 text-blue-100">
          Every figure below includes <span className="font-semibold">{activeAddon.name}</span> (
          {formatUnitAmount(activeAddon.amountPaise, activeAddon.currency)} for {activeAddon.screeningReviews} extra
          screening reviews) added to the plan price.
        </p>
      ) : null}

      {/* table-fixed shares the width across the five columns so nothing is
          pushed under a scrollbar. Scrolling stays as a fallback for very
          narrow screens only. */}
      <div className="mt-4 -mx-1 overflow-x-auto px-1">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">
            Comparison of HireVeri interview plans by price, included credits, and cost per interview
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-[96px] pb-3 pr-2 align-bottom text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:w-[116px]">
                Plan
              </th>
              {rows.map(({ plan }) => {
                const isSelected = plan.slug === selectedPlanSlug

                return (
                  <th
                    key={plan.id}
                    scope="col"
                    className={`pb-3 pl-1.5 pr-1.5 align-bottom ${isSelected ? "bg-blue-500/[0.07]" : ""}`}
                  >
                    {/* The badge sits outside and above the button, on a row every
                        column reserves, so all four boxes are the same size and
                        start at the same height whichever plan is popular or
                        selected. */}
                    <span className="mb-1 flex h-[18px] items-center justify-center">
                      {plan.isPopular ? (
                        <span className="whitespace-nowrap rounded-full bg-[#b45309] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.06em] text-white">
                          Most popular
                        </span>
                      ) : null}
                    </span>

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSelectPlan(plan.slug, withScreening ? addonSlug : "")}
                      aria-pressed={isSelected}
                      className={`flex w-full flex-col items-center rounded-xl border px-1.5 py-2 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        isSelected
                          ? "border-blue-400 bg-blue-500/10 ring-1 ring-blue-400/40"
                          : "border-slate-800 bg-slate-900 hover:border-slate-600"
                      }`}
                    >
                      <span className="block w-full truncate text-[13px] font-semibold leading-tight text-slate-100">
                        {plan.name}
                      </span>
                      <span
                        className={`mt-0.5 block text-[10px] font-medium leading-tight ${
                          isSelected ? "text-blue-100" : "text-slate-500"
                        }`}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody className="align-middle">
            <ComparisonRow label={activeAddon ? "Plan + add-on price (excl. GST)" : "Plan price (excl. GST)"}>
              {rows.map(({ plan, economics }) => (
                <Cell key={plan.id} emphasis selected={plan.slug === selectedPlanSlug}>
                  {economics.discounted && economics.regularPaise !== null ? (
                    <span className="flex flex-col gap-0.5">
                      <span className="text-xs font-normal text-slate-500 line-through">
                        {formatUnitAmount(economics.regularPaise, currency)}
                      </span>
                      <span className="text-emerald-100">
                        {formatUnitAmount(economics.totalPaise, currency)}
                      </span>
                      <span className="text-[10px] font-medium text-emerald-200">
                        Save {formatUnitAmount(economics.savingPaise, currency)}
                      </span>
                    </span>
                  ) : (
                    formatUnitAmount(economics.totalPaise, currency)
                  )}
                </Cell>
              ))}
            </ComparisonRow>

            <ComparisonRow label="Interviews included">
              {rows.map(({ plan, economics }) => (
                <Cell key={plan.id} selected={plan.slug === selectedPlanSlug}>{economics.interviews.toLocaleString()}</Cell>
              ))}
            </ComparisonRow>

            <ComparisonRow label="Screening reviews included">
              {rows.map(({ plan, economics }) => (
                <Cell key={plan.id} selected={plan.slug === selectedPlanSlug}>{economics.screenings.toLocaleString()}</Cell>
              ))}
            </ComparisonRow>

            <ComparisonRow
              label={activeAddon ? "Cost per interview (with screening, excl. GST)" : "Cost per interview (excl. GST)"}
              highlight
            >
              {rows.map(({ plan, economics }) => {
                const isBest =
                  economics.perInterviewPaise !== null && economics.perInterviewPaise === bestPerInterviewPaise

                return (
                  <Cell key={plan.id} emphasis selected={plan.slug === selectedPlanSlug}>
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      {economics.discounted && economics.regularPerInterviewPaise !== null ? (
                        <span className="text-xs font-normal text-slate-500 line-through">
                          {formatUnitAmount(economics.regularPerInterviewPaise, currency)}
                        </span>
                      ) : null}
                      <span className={economics.discounted ? "text-emerald-100" : undefined}>
                        {economics.perInterviewPaise === null
                          ? "--"
                          : formatUnitAmount(economics.perInterviewPaise, currency)}
                      </span>
                      {isBest ? (
                        <span className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-100">
                          Best value
                        </span>
                      ) : null}
                    </span>
                  </Cell>
                )
              })}
            </ComparisonRow>

            <ComparisonRow label="Cost per screening review (excl. GST)">
              {rows.map(({ plan, economics }) => (
                <Cell key={plan.id} selected={plan.slug === selectedPlanSlug}>
                  {economics.perScreeningPaise === null
                    ? "--"
                    : formatUnitAmount(economics.perScreeningPaise, currency)}
                </Cell>
              ))}
            </ComparisonRow>

            <ComparisonRow label="Screening reviews per interview">
              {rows.map(({ plan, economics }) => (
                <Cell key={plan.id} selected={plan.slug === selectedPlanSlug}>
                  {economics.interviews > 0 ? `${economics.screeningsPerInterview.toFixed(1)}x` : "--"}
                </Cell>
              ))}
            </ComparisonRow>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        All figures come from live billing records, are rounded for readability, and
        exclude GST and coupon discounts. The final payable amount, with tax and any coupon applied, is confirmed in the
        payment summary.
      </p>
    </div>
  )
}

function ComparisonRow({
  label,
  highlight = false,
  children,
}: {
  label: string
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <tr className={highlight ? "bg-slate-900" : undefined}>
      <th
        scope="row"
        className="border-t border-slate-800 py-2.5 pr-2 text-[11px] font-medium leading-4 text-slate-400"
      >
        {label}
      </th>
      {children}
    </tr>
  )
}

function Cell({
  emphasis = false,
  selected = false,
  children,
}: {
  emphasis?: boolean
  selected?: boolean
  children: React.ReactNode
}) {
  return (
    <td
      /* The selected plan is highlighted down its whole column so the figures a
         buyer is actually purchasing are readable as one block. */
      className={`border-t border-slate-800 py-2.5 pl-1.5 pr-1.5 text-[13px] ${
        emphasis ? "font-semibold text-slate-100" : "text-slate-300"
      } ${selected ? "bg-blue-500/[0.07]" : ""}`}
    >
      {children}
    </td>
  )
}
