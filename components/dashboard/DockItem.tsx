"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { memo, useState } from "react";

import DockTooltip from "./DockTooltip";

type DockItemProps = {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  alert?: boolean;
  badge?: number;
  href?: string;
  featured?: boolean;
  onClick?: () => void;
};

function formatBadge(value?: number) {
  if (!value || value <= 0) {
    return null;
  }

  return value > 99 ? "99+" : String(value);
}

function DockItem({
  icon: Icon,
  label,
  active = false,
  alert = false,
  badge,
  href,
  featured = false,
  onClick,
}: DockItemProps) {
  const [hovered, setHovered] = useState(false);
  const badgeLabel = formatBadge(badge);

  const content = (
    <motion.span
      className={[
        "group relative flex h-9 w-9 translate-z-0 items-center justify-center rounded-[16px] border transition-colors duration-200 will-change-transform xl:h-10 xl:w-10",
        active
          ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "border-transparent bg-white/[0.015] text-slate-300/95",
        alert
          ? "border-rose-300/24 bg-rose-500/10 text-rose-50 shadow-[0_0_22px_rgba(244,63,94,0.16)]"
          : "hover:border-cyan-300/18 hover:bg-cyan-400/10 hover:text-white hover:shadow-[0_0_18px_rgba(34,211,238,0.14),inset_0_1px_0_rgba(255,255,255,0.07)]",
        featured && !active ? "text-cyan-100/95 shadow-[0_0_22px_rgba(34,211,238,0.10)]" : "",
        featured ? "motion-safe:animate-[hv-dock-breathe_3.8s_ease-in-out_infinite]" : "",
      ].join(" ")}
      whileHover={{ scale: 1.12, x: 3 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.7 }}
    >
      {featured ? (
        <span className="pointer-events-none absolute inset-0 rounded-[18px] bg-[radial-gradient(circle_at_50%_20%,rgba(34,211,238,0.18),transparent_58%)] opacity-80" />
      ) : null}

      {active ? (
        <span className="absolute -left-2.5 top-1/2 hidden h-6 w-1 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.85)] md:block" />
      ) : null}

      {alert ? (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,0.95)]">
          <span className="absolute inset-0 rounded-full bg-rose-400/80 motion-safe:animate-ping" />
        </span>
      ) : null}

      <Icon
        aria-hidden="true"
        strokeWidth={featured ? 1.9 : 1.75}
        className={[
          "relative h-[16px] w-[16px] transition duration-200 xl:h-[18px] xl:w-[18px]",
          hovered || featured ? "drop-shadow-[0_0_10px_rgba(103,232,249,0.42)]" : "",
        ].join(" ")}
      />

      {badgeLabel ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-cyan-200/35 bg-cyan-400/20 px-1 text-[10px] font-semibold leading-none text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.18)] backdrop-blur-md">
          {badgeLabel}
        </span>
      ) : null}
    </motion.span>
  );

  const commonProps = {
    "aria-label": label,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: () => setHovered(true),
    onBlur: () => setHovered(false),
    className: "relative flex h-9 w-[46px] items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071226] xl:h-10 xl:w-12",
  };

  return (
    <div className="relative">
      {href ? (
        <Link {...commonProps} href={href}>
          {content}
        </Link>
      ) : (
        <button {...commonProps} type="button" onClick={onClick}>
          {content}
        </button>
      )}
      <DockTooltip label={label} open={hovered} />
    </div>
  );
}

export default memo(DockItem);
