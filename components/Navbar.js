"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { buildAuthUrl, hasAuthQuery } from "@/lib/client/auth-query";
import { ACTION_FEEDBACK_EVENT } from "@/lib/client/action-feedback";
import { logoutRecruiter } from "@/lib/client/logout";
import { DEFAULT_RECRUITER_PERMISSION_PROFILE, canAccessFeature } from "@/lib/client/permissions";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";
import ThemeSelector from "@/components/ThemeSelector";
import { useTheme } from "@/components/ThemeProvider";

const CreateJobModal = dynamic(() => import("./CreateJobModal"), {
  ssr: false,
});

const navItems = [
  { href: "/", label: "Dashboard", feature: "dashboard" },
  { href: "/ai-screening", label: "VERIS Screening", feature: "aiScreening" },
  { href: "/jobs", label: "Jobs", feature: "jobs" },
  { href: "/candidates", label: "Candidates", feature: "candidates" },
  { href: "/interviews", label: "Interviews", feature: "interviews" },
  { href: "/reports", label: "Reports", feature: "reports" },
  { href: "/billing", label: "Billing", feature: "billing" },
];

const ALERT_READ_STORAGE_KEY = "verisnova-read-alert-ids";
const ALERTS_CACHE_KEY = "verisnova-dashboard-alerts";
const ALERTS_READ_EVENT = "verisnova:alerts-read";
const PROFILE_PERMISSION_CACHE_KEY = "verisnova-recruiter-profile-permissions";

function normalizeStorageKeyPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getAlertReadStorageKey(profile) {
  const organization = normalizeStorageKeyPart(profile?.organization);
  return organization ? `${ALERT_READ_STORAGE_KEY}:${organization}` : ALERT_READ_STORAGE_KEY;
}

function isActivePath(pathname, href) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname.startsWith(href);
}

function CogIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 1-2 0 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 1 0-2 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 1 2 0 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.24.32.44.67.6 1a1.65 1.65 0 0 1 0 2c-.16.33-.36.68-.6 1Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </svg>
  );
}

function CreditsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-5" />
      <path d="M12 16V8" />
      <path d="M16 16v-3" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function getAlertToneClass(tone) {
  if (tone === "success") return "border-emerald-400/25 bg-emerald-500/10"
  if (tone === "warning") return "border-amber-400/25 bg-amber-500/10"
  if (tone === "danger") return "border-rose-400/25 bg-rose-500/10"
  return "border-sky-400/20 bg-sky-500/10"
}

function getFeedbackToneClass(tone) {
  if (tone === "success") {
    return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100 shadow-[0_24px_70px_rgba(16,185,129,0.12)]";
  }

  if (tone === "warning") {
    return "border-amber-400/35 bg-amber-500/10 text-amber-100 shadow-[0_24px_70px_rgba(245,158,11,0.12)]";
  }

  if (tone === "error" || tone === "danger") {
    return "border-rose-400/35 bg-rose-500/10 text-rose-100 shadow-[0_24px_70px_rgba(244,63,94,0.12)]";
  }

  return "border-cyan-400/35 bg-cyan-500/10 text-cyan-100 shadow-[0_24px_70px_rgba(34,211,238,0.12)]";
}

function formatAlertTime(value) {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function readCachedPermissionProfile() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PROFILE_PERMISSION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.permissions) ? parsed : null;
  } catch {
    return null;
  }
}

function cachePermissionProfile(profile) {
  if (typeof window === "undefined" || !Array.isArray(profile?.permissions)) {
    return;
  }

  try {
    window.sessionStorage.setItem(PROFILE_PERMISSION_CACHE_KEY, JSON.stringify({
      permissions: profile.permissions,
      name: profile.name,
      organization: profile.organization,
      userId: profile.userId,
      organizationId: profile.organizationId,
    }));
  } catch {
    // Permission cache is only a startup accelerator.
  }
}

function readCachedAlerts() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.sessionStorage.getItem(ALERTS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function cacheAlerts(alerts) {
  if (typeof window === "undefined" || !Array.isArray(alerts)) {
    return;
  }

  try {
    window.sessionStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify(alerts));
  } catch {
    // Alerts cache is only a startup accelerator.
  }
}

export default function Navbar({ onSendInterviewClick: _onSendInterviewClick, initialProfile = null, initialAlerts = undefined }) {
  const { resolvedTheme } = useTheme();
  /* Two different marks, and they need different treatment. The dark-theme
     asset is line art on transparency with wide padding baked in, so it is
     oversized and cropped by the tile to trim that padding. The light-theme
     asset already fills its own frame, so the same crop cut into the mark -
     it is fitted to the tile instead, on a white ground rather than navy. */
  const isLightTheme = resolvedTheme === "light";
  const logoSrc = isLightTheme ? "/verisnova_logo_on_white.png" : "/verisnova_logo.png";
  const logoTileClass = isLightTheme
    ? "border-slate-200 bg-white group-hover:border-slate-300"
    : "border-slate-700 bg-slate-900 group-hover:border-slate-500";
  const logoImageClass = isLightTheme
    ? "h-full w-full object-contain"
    : "h-[5.1rem] w-[5.1rem] max-w-none object-contain";
  const pathname = usePathname();
  const searchParams = useAuthSearchParams();
  const menuRef = useRef(null);
  const alertsRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const [openCreateJob, setOpenCreateJob] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState(() => initialAlerts ?? []);
  const [readAlertIds, setReadAlertIds] = useState(() => new Set());
  const [feedback, setFeedback] = useState(null);
  const [profile, setProfile] = useState(() => initialProfile);
  const displayProfile = initialProfile?.name ? initialProfile : profile;
  const permissionProfile = displayProfile?.permissions?.length ? displayProfile : DEFAULT_RECRUITER_PERMISSION_PROFILE;
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => canAccessFeature(permissionProfile, item.feature)),
    [permissionProfile]
  );
  const canViewAlerts = canAccessFeature(permissionProfile, "alerts");
  const canManageTeam = canAccessFeature(displayProfile, "manageTeam");
  const canViewBilling = canAccessFeature(displayProfile, "billing");
  const canManageSettings = canAccessFeature(displayProfile, "settings");
  const alertReadStorageKey = useMemo(() => getAlertReadStorageKey(displayProfile), [displayProfile]);

  useEffect(() => {
    let active = true;

    if (initialAlerts === undefined) {
      const cachedAlerts = readCachedAlerts();
      if (cachedAlerts) {
        window.queueMicrotask(() => {
          if (active) {
            setAlerts(cachedAlerts);
          }
        });
      }
    }

    if (!initialProfile?.name) {
      const cachedProfile = readCachedPermissionProfile();
      if (cachedProfile) {
        window.queueMicrotask(() => {
          if (active) {
            setProfile((current) => current?.name ? current : cachedProfile);
          }
        });
      }
    }

    return () => {
      active = false;
    };
  }, [initialAlerts, initialProfile]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored =
        window.localStorage.getItem(alertReadStorageKey) ||
        window.localStorage.getItem(ALERT_READ_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) {
        const nextReadIds = new Set(parsed.filter((id) => typeof id === "string" && id.length > 0));
        queueMicrotask(() => setReadAlertIds(nextReadIds));

        if (alertReadStorageKey !== ALERT_READ_STORAGE_KEY) {
          window.localStorage.setItem(alertReadStorageKey, JSON.stringify([...nextReadIds]));
        }
      }
    } catch {
      queueMicrotask(() => setReadAlertIds(new Set()));
    }
  }, [alertReadStorageKey]);

  useEffect(() => {
    if (initialAlerts !== undefined) {
      queueMicrotask(() => setAlerts(initialAlerts ?? []));
      cacheAlerts(initialAlerts ?? []);
    }
  }, [initialAlerts]);

  useEffect(() => {
    if (initialProfile?.name) {
      queueMicrotask(() => setProfile((current) => current?.name ? current : initialProfile));
      cachePermissionProfile(initialProfile);
    }
  }, [initialProfile]);

  useEffect(() => {
    if (!hasAuthQuery(searchParams) || initialAlerts !== undefined || alerts.length > 0) {
      return;
    }

    let active = true;

    fetch(buildAuthUrl("/api/dashboard/alerts", searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (active && data.success) {
          setAlerts(data.data ?? []);
          cacheAlerts(data.data ?? []);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [alerts.length, initialAlerts, searchParams]);

  useEffect(() => {
    if (!hasAuthQuery(searchParams) || initialProfile?.name || profile?.name) {
      return;
    }

    let active = true;

    fetch(buildAuthUrl("/api/me", searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (!active) {
          return;
        }

        if (data.success && data.data?.name) {
          setProfile(data.data);
          cachePermissionProfile(data.data);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [initialProfile, profile?.name, searchParams]);

  const unreadAlerts = useMemo(
    () => alerts.filter((alert) => !readAlertIds.has(alert.id)),
    [alerts, readAlertIds]
  );

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
      if (alertsRef.current && !alertsRef.current.contains(event.target)) {
        setAlertsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setProfileOpen(false);
        setAlertsOpen(false);
      }
    }

    function handleOpenCreateJobEvent() {
      setOpenCreateJob(true);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("verisnova:open-create-job", handleOpenCreateJobEvent);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("verisnova:open-create-job", handleOpenCreateJobEvent);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handleActionFeedback(event) {
      const nextFeedback = {
        title: event.detail?.title || "Action completed",
        message: event.detail?.message || "",
        tone: event.detail?.tone || "success",
      };

      setFeedback(nextFeedback);

      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }

      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback(null);
        feedbackTimerRef.current = null;
      }, 4200);
    }

    window.addEventListener(ACTION_FEEDBACK_EVENT, handleActionFeedback);

    return () => {
      window.removeEventListener(ACTION_FEEDBACK_EVENT, handleActionFeedback);
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const initials = useMemo(() => {
    return (
      displayProfile?.name
        ?.split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase() || "HR"
    );
  }, [displayProfile]);

  const handleLogout = () => {
    setProfileOpen(false);
    logoutRecruiter();
  };

  function persistReadAlertIds(nextReadIds) {
    setReadAlertIds(nextReadIds);

    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(alertReadStorageKey, JSON.stringify([...nextReadIds]));
    } catch {
      // Read state is a convenience layer; ignore storage failures.
    }
  }

  async function persistReadAlertsOnServer(alertIds) {
    if (!hasAuthQuery(searchParams) || alertIds.length === 0) {
      return true;
    }

    try {
      const response = await fetch(buildAuthUrl("/api/dashboard/alerts", searchParams), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertIds }),
      });

      if (!response.ok) {
        return false;
      }

      const payload = await response.json().catch(() => null);
      return Boolean(payload?.success);
    } catch {
      return false;
    }
  }

  function restoreUnreadAlerts(alertIds) {
    setReadAlertIds((current) => {
      const nextReadIds = new Set(current);
      alertIds.forEach((alertId) => nextReadIds.delete(alertId));

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(alertReadStorageKey, JSON.stringify([...nextReadIds]));
        } catch {
          // Local read markers are best-effort; server state remains authoritative.
        }
      }

      return nextReadIds;
    });
  }

  function handleMarkAlertRead(alertId) {
    const nextReadIds = new Set(readAlertIds);
    nextReadIds.add(alertId);
    persistReadAlertIds(nextReadIds);
    setAlerts((current) => current.filter((alert) => alert.id !== alertId));
    window.dispatchEvent(new CustomEvent(ALERTS_READ_EVENT, { detail: { alertIds: [alertId] } }));
    void persistReadAlertsOnServer([alertId]).then((persisted) => {
      if (!persisted) {
        restoreUnreadAlerts([alertId]);
        fetch(buildAuthUrl("/api/dashboard/alerts", searchParams), {
          credentials: "include",
          cache: "no-store",
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setAlerts(data.data ?? []);
            }
          })
          .catch(() => {});
      }
    });
  }

  function handleMarkAllAlertsRead() {
    const nextReadIds = new Set(readAlertIds);
    const alertIds = unreadAlerts.map((alert) => alert.id);
    alertIds.forEach((alertId) => nextReadIds.add(alertId));
    persistReadAlertIds(nextReadIds);
    setAlerts((current) => current.filter((alert) => !alertIds.includes(alert.id)));
    window.dispatchEvent(new CustomEvent(ALERTS_READ_EVENT, { detail: { alertIds } }));
    void persistReadAlertsOnServer(alertIds).then((persisted) => {
      if (!persisted) {
        restoreUnreadAlerts(alertIds);
        fetch(buildAuthUrl("/api/dashboard/alerts", searchParams), {
          credentials: "include",
          cache: "no-store",
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setAlerts(data.data ?? []);
            }
          })
          .catch(() => {});
      }
    });
  }

  const handleNavigationClick = (href) => {
    if (href === pathname) {
      return;
    }
  };

  return (
    <>
      <header className="hv-navbar sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/92 text-white shadow-[0_8px_28px_rgba(2,6,23,0.16)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-slate-800/80" />
        <div className="relative mx-auto flex w-full max-w-[1840px] flex-nowrap items-center justify-between gap-3 px-3 py-4 sm:px-4 xl:px-6">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 xl:gap-3">
            <Link
              href="/"
              onClick={() => handleNavigationClick("/")}
              className="group flex w-[108px] shrink-0 items-center gap-3 leading-none sm:w-[220px] xl:w-[244px]"
              aria-label="VerisNova home"
            >
              <span
                className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border shadow-sm transition-all duration-200 ${logoTileClass}`}
              >
                <Image
                  src={logoSrc}
                  alt=""
                  width={88}
                  height={88}
                  priority
                  className={logoImageClass}
                  sizes="48px"
                />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold tracking-tight text-white xl:text-xl">VerisNova</span>
                <span className="mt-1 hidden whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 sm:block">
                  Hiring Workspace
                </span>
              </span>
            </Link>

            <nav className="hidden min-w-0 flex-1 flex-nowrap items-center justify-center gap-0.5 overflow-visible md:flex xl:gap-1">
              {visibleNavItems.map((item) => {
                const active = isActivePath(pathname, item.href);

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => handleNavigationClick(item.href)}
                    className={[
                      "hv-nav-link group relative inline-flex transform-gpu whitespace-nowrap rounded-lg border px-2.5 py-2 text-[13px] tracking-[0.005em] transition-all duration-200 will-change-transform xl:px-3 xl:text-sm",
                      active
                        ? "hv-nav-link-active border-slate-700 bg-slate-900 font-semibold text-white shadow-sm"
                        : "border-transparent text-slate-300/90 hover:border-slate-700 hover:bg-slate-900/70 hover:text-white",
                    ].join(" ")}
                  >
                    <span className="relative z-10">{item.label}</span>
                    <span
                      className={[
                        "pointer-events-none absolute inset-x-2 -bottom-px h-px rounded-full bg-sky-400 transition-all duration-200",
                        active
                          ? "opacity-100"
                          : "scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-60",
                      ].join(" ")}
                    />
                  </Link>
                );
              })}

              {canViewAlerts ? (
              <div className="relative shrink-0" ref={alertsRef}>
                <button
                  type="button"
                  onClick={() => setAlertsOpen((value) => !value)}
                  className={[
                    "hv-nav-link group relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-2 text-[13px] font-medium tracking-[0.005em] transition-all duration-200 will-change-transform xl:px-3 xl:text-sm",
                    alertsOpen
                      ? "hv-nav-link-active border-slate-700 bg-slate-900 text-white shadow-sm"
                      : "border-transparent text-slate-300/90 hover:border-slate-700 hover:bg-slate-900/70 hover:text-white",
                  ].join(" ")}
                >
                  Alerts
                  {unreadAlerts.length > 0 ? (
                    <span className="relative inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-sky-300/30 bg-sky-500/15 px-1 text-[10px] font-semibold leading-none text-sky-50">
                      {unreadAlerts.length}
                    </span>
                  ) : null}
                  <span className={["pointer-events-none absolute inset-x-2 -bottom-px h-px rounded-full bg-sky-400 transition-all duration-200", alertsOpen ? "opacity-100" : "scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-55"].join(" ")} />
                </button>

                {alertsOpen ? (
                  <div className="absolute right-0 top-[calc(100%+14px)] z-50 w-[360px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/98 p-4 shadow-[0_24px_70px_rgba(2,6,23,0.42)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-white">Alerts</h2>
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Interview Activity</p>
                      </div>
                      {unreadAlerts.length > 0 ? (
                        <button
                          type="button"
                          onClick={handleMarkAllAlertsRead}
                          className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-500/20"
                        >
                          Mark all as read
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                      {unreadAlerts.length === 0 ? (
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/35 px-4 py-5 text-sm text-slate-400">
                          No unread interview activity alerts.
                        </div>
                      ) : (
                        unreadAlerts.map((alert) => (
                          <article key={alert.id} className={`rounded-2xl border px-4 py-3 ${getAlertToneClass(alert.tone)}`}>
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-white">{alert.title}</p>
                              <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                                {formatAlertTime(alert.occurredAt)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-200">{alert.message}</p>
                            <div className="mt-3 flex justify-end">
                              <button
                                type="button"
                                onClick={() => handleMarkAlertRead(alert.id)}
                                className="rounded-lg border border-white/10 bg-slate-950/30 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-500/10 hover:text-cyan-100"
                              >
                                Read
                              </button>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              ) : null}
            </nav>
          </div>

          <div className="ml-1 flex shrink-0 flex-nowrap items-center gap-2">
            <ThemeSelector />
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((value) => !value)}
                className="flex transform-gpu items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-2 shadow-sm transition-all duration-200 hover:border-slate-500 lg:gap-3 lg:px-3"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-sm font-semibold text-slate-100 lg:h-10 lg:w-10">
                  {initials}
                </div>
                <div className="hidden min-w-0 text-left 2xl:block">
                  <div className="max-w-[120px] truncate text-sm font-semibold text-white">{displayProfile?.name || "Recruiter"}</div>
                  <div className="max-w-[140px] truncate text-xs text-slate-400">{displayProfile?.organization || "Workspace"}</div>
                </div>
              </button>

              {profileOpen ? (
                <div className="absolute right-0 top-[calc(100%+12px)] z-50 w-[260px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/98 p-2 shadow-[0_20px_60px_rgba(2,6,23,0.38)]">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/35 px-4 py-3">
                    <div className="text-sm font-semibold text-white">{displayProfile?.name || "Recruiter"}</div>
                    <div className="mt-1 text-xs text-slate-400">{displayProfile?.organization || "Authenticated workspace"}</div>
                  </div>

                  <div className="mt-2 grid gap-1">
                    {canManageTeam ? (
                    <Link href="/manage-team" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-200 transition hover:bg-slate-800/70 hover:text-white" onClick={() => { setProfileOpen(false); handleNavigationClick("/manage-team"); }}>
                      <TeamIcon />
                      <span>Manage Team</span>
                    </Link>
                    ) : null}

                    {canViewBilling ? (
                    <Link href="/billing" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-200 transition hover:bg-slate-800/70 hover:text-white" onClick={() => { setProfileOpen(false); handleNavigationClick("/billing"); }}>
                      <BillingIcon />
                      <span>Billing & Orders</span>
                    </Link>
                    ) : null}

                    {canViewBilling ? (
                    <Link href="/billing#usage" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-200 transition hover:bg-slate-800/70 hover:text-white" onClick={() => { setProfileOpen(false); handleNavigationClick("/billing"); }}>
                      <CreditsIcon />
                      <span>Usage & Credits</span>
                    </Link>
                    ) : null}

                    {canManageSettings ? (
                    <Link href="/settings" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-200 transition hover:bg-slate-800/70 hover:text-white" onClick={() => { setProfileOpen(false); handleNavigationClick("/settings"); }}>
                      <CogIcon />
                      <span>Settings</span>
                    </Link>
                    ) : null}

                    <Link href="/contact-us" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-200 transition hover:bg-slate-800/70 hover:text-white" onClick={() => { setProfileOpen(false); handleNavigationClick("/contact-us"); }}>
                      <MailIcon />
                      <span>Contact Us</span>
                    </Link>

                    <button type="button" onClick={handleLogout} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-rose-200 transition hover:bg-rose-500/10 hover:text-rose-100">
                      <LogoutIcon />
                      <span>Logout</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {feedback ? (
        <div className="fixed right-4 top-20 z-[90] w-[min(420px,calc(100vw-2rem))]">
          <div className={`rounded-2xl border px-4 py-3 backdrop-blur-xl ${getFeedbackToneClass(feedback.tone)}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{feedback.title}</p>
                {feedback.message ? (
                  <p className="mt-1 text-sm leading-5 text-current/80">{feedback.message}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="shrink-0 rounded-lg border border-white/10 bg-slate-950/20 px-2 py-1 text-xs font-semibold text-white/80 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openCreateJob ? <CreateJobModal open={openCreateJob} setOpen={setOpenCreateJob} /> : null}
    </>
  );
}
