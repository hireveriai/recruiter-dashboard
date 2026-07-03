"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  ClipboardList,
  Link2,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  SquarePlus,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAuthUrl } from "@/lib/client/auth-query";
import { DEFAULT_RECRUITER_PERMISSION_PROFILE, canAccessFeature } from "@/lib/client/permissions";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";
import DockItem from "./DockItem";
import DockSection from "./DockSection";

type DashboardAlert = {
  id?: string;
  title?: string;
  message?: string;
  tone?: string;
  type?: string;
};

type CognitiveDockProps = {
  activeInterviewCount?: number;
  candidateCount?: number;
  flaggedCount?: number;
  alerts?: DashboardAlert[];
  overview?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  onSendInterviewClick?: () => void;
};

type PanelMode = "search" | "alerts" | "copilot" | null;

type SearchItem = {
  id: string;
  type: "Job" | "Candidate" | "Interview" | "Report" | "Action";
  title: string;
  meta: string;
  href?: string;
  action?: () => void;
  icon: LucideIcon;
  score?: number | null;
};

type WorkspaceData = {
  jobs: Array<Record<string, unknown>>;
  candidates: Array<Record<string, unknown>>;
  interviews: Array<Record<string, unknown>>;
  reports: Record<string, unknown> | null;
};

type WorkspacePayload = Partial<WorkspaceData>;

function getPanelTitle(panel: PanelMode) {
  if (panel === "search") return "Universal Search";
  if (panel === "alerts") return "Review Flags";
  if (panel === "copilot") return "VERIS Copilot";
  return "";
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSearch(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function getDecisionTone(decision: unknown) {
  const normalized = normalizeSearch(decision);
  if (normalized.includes("hire") || normalized.includes("select")) return "text-emerald-200";
  if (normalized.includes("flag") || normalized.includes("reject")) return "text-rose-200";
  return "text-cyan-200";
}

function getPanelLoadingLabel(panel: PanelMode) {
  if (panel === "copilot") return "Building VERIS recommendations...";
  return "Syncing workspace intelligence...";
}

function hasWorkspaceData(workspace: WorkspaceData) {
  return Boolean(workspace.jobs.length || workspace.candidates.length || workspace.interviews.length || workspace.reports);
}

function mergeWorkspaceData(current: WorkspaceData, next: WorkspacePayload): WorkspaceData {
  return {
    jobs: next.jobs ?? current.jobs,
    candidates: next.candidates ?? current.candidates,
    interviews: next.interviews ?? current.interviews,
    reports: next.reports ?? current.reports,
  };
}

function present<T>(value: T | null | undefined | false): value is T {
  return Boolean(value);
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      credentials: "include",
      cache: "default",
      signal: controller.signal,
    });
    return response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function CognitiveDock({
  activeInterviewCount = 0,
  candidateCount = 0,
  flaggedCount = 0,
  alerts = [],
  overview = null,
  profile = null,
  onSendInterviewClick,
}: CognitiveDockProps) {
  const pathname = usePathname();
  const searchParams = useAuthSearchParams();
  const [panel, setPanel] = useState<PanelMode>(null);
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData>({ jobs: [], candidates: [], interviews: [], reports: null });
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");

  const apiHref = useCallback((path: string) => buildAuthUrl(path, searchParams), [searchParams]);
  const pageHref = useCallback((path: string) => path, []);
  const hasFlaggedCandidates = flaggedCount > 0;
  const hasLiveWorkspaceData = hasWorkspaceData(workspace);
  const permissionProfile = Array.isArray(profile?.permissions) && profile.permissions.length > 0
    ? profile
    : DEFAULT_RECRUITER_PERMISSION_PROFILE;
  const canCreateJob = canAccessFeature(permissionProfile, "createJob");
  const canSendInterview = canAccessFeature(permissionProfile, "sendInterview");
  const canViewCandidates = canAccessFeature(permissionProfile, "candidates");
  const canViewInterviews = canAccessFeature(permissionProfile, "interviews");
  const canViewReports = canAccessFeature(permissionProfile, "reports");
  const canViewAlerts = canAccessFeature(permissionProfile, "alerts");
  const canUseCopilot = canAccessFeature(permissionProfile, "copilot");

  const openCreateJob = useCallback(() => {
    window.dispatchEvent(new CustomEvent("hireveri:open-create-job"));
    setPanel(null);
  }, []);

  const openSendInterview = useCallback(() => {
    onSendInterviewClick?.();
    setPanel(null);
  }, [onSendInterviewClick]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanel("search");
      }

      if (event.key === "Escape") {
        setPanel(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (panel !== "search" && panel !== "copilot") {
      return;
    }

    let active = true;
    let loaderCeilingTimer: number | undefined;
    const loadTimer = window.setTimeout(() => {
      const overviewWorkspace: WorkspacePayload = {
        candidates: Array.isArray(overview?.candidates) ? overview.candidates as Array<Record<string, unknown>> : undefined,
        interviews: Array.isArray(overview?.pendingInterviews) ? overview.pendingInterviews as Array<Record<string, unknown>> : undefined,
        reports: overview ?? null,
      };

      if (hasWorkspaceData(mergeWorkspaceData(workspace, overviewWorkspace))) {
        setWorkspace((current) => mergeWorkspaceData(current, overviewWorkspace));
      }

      setWorkspaceLoading(!hasWorkspaceData(mergeWorkspaceData(workspace, overviewWorkspace)));
      setWorkspaceError("");
      loaderCeilingTimer = window.setTimeout(() => {
        if (active) {
          setWorkspaceLoading(false);
        }
      }, 900);

      Promise.allSettled([
        fetchJsonWithTimeout(apiHref("/api/jobs"), 4500),
        fetchJsonWithTimeout(apiHref("/api/dashboard/candidates?limit=80"), 4500),
        fetchJsonWithTimeout(apiHref("/api/dashboard/interviews?limit=80&includeAnswers=0"), 4500),
        fetchJsonWithTimeout(apiHref("/api/reports/overview"), 5200),
      ])
        .then((results) => {
          if (!active) return;

          const [jobsResult, candidatesResult, interviewsResult, reportsResult] = results;
          const jobsPayload = jobsResult.status === "fulfilled" ? jobsResult.value : null;
          const candidatesPayload = candidatesResult.status === "fulfilled" ? candidatesResult.value : null;
          const interviewsPayload = interviewsResult.status === "fulfilled" ? interviewsResult.value : null;
          const reportsPayload = reportsResult.status === "fulfilled" ? reportsResult.value : null;
          const nextWorkspace: WorkspacePayload = {
            jobs: jobsPayload?.jobs ?? jobsPayload?.data?.jobs,
            candidates: candidatesPayload?.data,
            interviews: interviewsPayload?.data,
            reports: reportsPayload?.data,
          };
          const failedCount = results.filter((result) => result.status === "rejected").length;

          setWorkspace((current) => mergeWorkspaceData(current, nextWorkspace));

          if (failedCount > 0) {
            setWorkspaceError("Some live workspace signals are delayed. Showing available dashboard intelligence.");
          }
        })
        .catch(() => {
          if (active) {
            setWorkspaceError("Live workspace sync is delayed. Showing available dashboard intelligence.");
          }
        })
        .finally(() => {
          if (active) {
            if (loaderCeilingTimer) {
              window.clearTimeout(loaderCeilingTimer);
            }
            setWorkspaceLoading(false);
          }
        });
    }, 80);

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
      if (loaderCeilingTimer) {
        window.clearTimeout(loaderCeilingTimer);
      }
    };
  }, [panel, apiHref, overview]);

  useEffect(() => {
    if (!overview) {
      return;
    }

    setWorkspace((current) => mergeWorkspaceData(current, {
      candidates: Array.isArray(overview.candidates) ? overview.candidates as Array<Record<string, unknown>> : undefined,
      interviews: Array.isArray(overview.pendingInterviews) ? overview.pendingInterviews as Array<Record<string, unknown>> : undefined,
      reports: overview,
    }));
  }, [overview]);

  const searchItems = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [
      ...(canCreateJob ? [{
        id: "action-create-job",
        type: "Action",
        title: "Create Job",
        meta: "Launch role configuration",
        action: openCreateJob,
        icon: SquarePlus,
      } as SearchItem] : []),
      ...(canSendInterview ? [{
        id: "action-send-interview",
        type: "Action",
        title: "Send Interview Link",
        meta: "Open secure candidate invite",
        action: openSendInterview,
        icon: Link2,
      } as SearchItem] : []),
      ...(canViewReports ? [{
        id: "report-overview",
        type: "Report",
        title: "Reports Snapshot",
        meta: "Open forensic analytics and decision trends",
        href: pageHref("/reports"),
        icon: BarChart3,
      } as SearchItem] : []),
    ];

    workspace.jobs.slice(0, 40).forEach((job) => {
      const id = readText(job.jobId ?? job.job_id, readText(job.jobTitle, "job"));
      const title = readText(job.jobTitle ?? job.job_title, "Untitled role");
      const skills = Array.isArray(job.coreSkills) ? job.coreSkills.join(", ") : "";
      const interviews = readNumber((job._count as Record<string, unknown> | undefined)?.interviews) ?? 0;

      items.push({
        id: `job-${id}`,
        type: "Job",
        title,
        meta: [skills || "Role configuration", `${interviews} interview${interviews === 1 ? "" : "s"}`].join(" - "),
        href: pageHref("/jobs"),
        icon: BriefcaseBusiness,
      });
    });

    workspace.candidates.slice(0, 80).forEach((candidate) => {
      const id = readText(candidate.candidateId, readText(candidate.candidateName, "candidate"));
      const score = readNumber(candidate.score ?? candidate.verisScreeningScore);

      items.push({
        id: `candidate-${id}`,
        type: "Candidate",
        title: readText(candidate.candidateName, "Candidate"),
        meta: [readText(candidate.jobTitle, "Unassigned role"), readText(candidate.status, "Pipeline"), candidate.decision ? `Decision: ${candidate.decision}` : null]
          .filter(Boolean)
          .join(" - "),
        href: canViewCandidates ? pageHref("/candidates") : undefined,
        icon: Users,
        score,
      });
    });

    workspace.interviews.slice(0, 80).forEach((interview) => {
      const id = readText(interview.interviewId, readText(interview.candidateName, "interview"));
      const score = readNumber(interview.score);

      items.push({
        id: `interview-${id}`,
        type: "Interview",
        title: readText(interview.candidateName, "Candidate interview"),
        meta: [readText(interview.jobTitle, "Interview"), readText(interview.status, "Status pending"), interview.decision ? `Decision: ${interview.decision}` : null]
          .filter(Boolean)
          .join(" - "),
        href: canViewInterviews ? pageHref("/interviews") : undefined,
        icon: ClipboardList,
        score,
      });
    });

    const normalizedQuery = normalizeSearch(query);
    if (!normalizedQuery) {
      return items.slice(0, 12);
    }

    return items
      .filter((item) => normalizeSearch(`${item.type} ${item.title} ${item.meta}`).includes(normalizedQuery))
      .slice(0, 14);
  }, [workspace, query, pageHref, openCreateJob, openSendInterview, canCreateJob, canSendInterview, canViewReports, canViewCandidates, canViewInterviews]);

  const copilot = useMemo(() => {
    const interviews = workspace.interviews;
    const candidates = workspace.candidates;
    const jobs = workspace.jobs;
    const reports = workspace.reports ?? {};
    const pipeline = (overview?.pipeline as Record<string, unknown> | undefined) ?? {};

    const completed = interviews.filter((item) => normalizeSearch(item.status).includes("completed") || item.endedAt).length;
    const flagged = candidates.filter((item) => normalizeSearch(`${item.status} ${item.decision} ${item.aiSummaryFull}`).includes("flag")).length + flaggedCount;
    const highScoreCandidates = candidates.filter((item) => {
      const score = readNumber(item.score ?? item.verisScreeningScore);
      return score !== null && score >= 75;
    });
    const pending = activeInterviewCount || readNumber(pipeline.pending) || interviews.filter((item) => !item.endedAt).length;
    const activeJobs = jobs.filter((job) => job.isActive !== false).length;
    const avgScore = readNumber((reports.executiveSummary as Record<string, unknown> | undefined)?.averageScore);

    const priorities = [
      flagged > 0
        ? {
            title: "Review integrity signals first",
            body: `${flagged} candidate risk signal${flagged === 1 ? "" : "s"} detected. Resolve flagged evidence before advancing offers.`,
            tone: "risk",
          }
        : {
            title: "Integrity posture is clear",
            body: "No active review flags are visible from dashboard signals. Continue monitoring interview evidence.",
            tone: "stable",
          },
      pending
        ? {
            title: "Move pending interviews forward",
            body: `${pending} interview${pending === 1 ? "" : "s"} or review item${pending === 1 ? "" : "s"} need recruiter action.`,
            tone: "focus",
          }
        : {
            title: "Pipeline review queue is quiet",
            body: "No active pending interview count is currently visible.",
            tone: "stable",
          },
      highScoreCandidates.length > 0
        ? {
            title: "Shortlist high-fit candidates",
            body: `${highScoreCandidates.length} candidate${highScoreCandidates.length === 1 ? "" : "s"} scored 75+ across VERIS or interview evaluation.`,
            tone: "opportunity",
          }
        : {
            title: "Generate more decision signal",
            body: "No 75+ candidate score is visible yet. Send interviews or run VERIS Screening to enrich the queue.",
            tone: "focus",
          },
    ];

    const metrics = [
      { label: "Active jobs", value: activeJobs },
      { label: "Candidates", value: candidates.length || candidateCount },
      { label: "Completed", value: completed },
      { label: "Avg score", value: avgScore === null ? "-" : `${Math.round(avgScore)}%` },
    ];

    return { priorities, metrics };
  }, [workspace, overview, activeInterviewCount, candidateCount, flaggedCount]);

  const dockSections = [
    {
      label: "Quick Actions",
      items: [
        canCreateJob ? { label: "Create Job", icon: SquarePlus, onClick: openCreateJob, active: false } : null,
        canSendInterview ? { label: "Send Interview Link", icon: Link2, onClick: openSendInterview, active: false } : null,
      ].filter(present),
    },
    {
      label: "Operations",
      items: [
        canViewInterviews ? {
          label: "Interview Queue",
          icon: ClipboardList,
          href: pageHref("/interviews"),
          badge: activeInterviewCount,
          active: pathname.startsWith("/interviews"),
        } : null,
        canViewCandidates ? { label: "Candidates Queue", icon: Users, href: pageHref("/candidates"), active: pathname.startsWith("/candidates") } : null,
        canViewAlerts ? {
          label: "Review Flags",
          icon: ShieldAlert,
          onClick: () => setPanel("alerts"),
          badge: flaggedCount,
          alert: hasFlaggedCandidates,
          active: panel === "alerts",
        } : null,
        canViewReports ? { label: "Reports Snapshot", icon: BarChart3, href: pageHref("/reports"), active: pathname.startsWith("/reports") } : null,
        { label: "Universal Search", icon: Search, onClick: () => setPanel("search"), active: panel === "search" },
      ].filter(present),
    },
    {
      label: "Intelligence",
      items: [
        canUseCopilot ? { label: "VERIS Copilot", icon: BrainCircuit, onClick: () => setPanel("copilot"), active: panel === "copilot", featured: true } : null,
      ].filter(present),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <>
      <motion.aside
        initial={{ opacity: 0, x: -18, scale: 0.96 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 md:bottom-auto md:left-4 md:top-[calc(50%+44px)] md:-translate-x-0 md:-translate-y-1/2 lg:left-5 xl:left-6"
        aria-label="Cognitive Operations Dock"
      >
        <div className="relative rounded-[32px] border border-white/5 bg-[#081120]/55 p-1.5 shadow-[0_18px_60px_rgba(2,6,23,0.36),0_0_34px_rgba(34,211,238,0.055)] backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.01)_38%,transparent),radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.105),transparent_46%)]" />
          <motion.nav
            className="relative flex max-w-[calc(100vw-2rem)] items-center gap-1.5 overflow-x-auto md:max-h-[calc(100dvh-10rem)] md:w-[52px] md:max-w-none md:flex-col md:gap-2 md:overflow-visible xl:w-14"
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.045, delayChildren: 0.12 } } }}
          >
            {dockSections.map((section, sectionIndex) => (
              <motion.div
                key={section.label}
                className="flex items-center gap-1.5 md:flex-col md:gap-2"
                variants={{ hidden: { opacity: 0, y: 8, scale: 0.96 }, visible: { opacity: 1, y: 0, scale: 1 } }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                {sectionIndex > 0 ? (
                  <span className="h-7 w-px shrink-0 rounded-full bg-white/8 md:h-px md:w-8" aria-hidden="true" />
                ) : null}
                <DockSection label={section.label}>
                  {section.items.map((item) => (
                    <DockItem key={item.label} {...item} />
                  ))}
                </DockSection>
              </motion.div>
            ))}
          </motion.nav>
        </div>
      </motion.aside>

      <AnimatePresence>
        {panel ? (
          <motion.div
            className="fixed inset-0 z-[65] bg-slate-950/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPanel(null)}
          >
            <motion.section
              role="dialog"
              aria-label={getPanelTitle(panel)}
              className="absolute bottom-24 left-1/2 max-h-[min(76dvh,720px)] w-[min(92vw,640px)] -translate-x-1/2 overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[#071226]/95 p-5 text-white shadow-[0_30px_100px_rgba(2,6,23,0.65),0_0_56px_rgba(34,211,238,0.12)] backdrop-blur-2xl md:bottom-auto md:left-24 md:top-1/2 md:translate-x-0 md:-translate-y-1/2"
              initial={{ opacity: 0, x: -10, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -10, scale: 0.97 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.13),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">Cognitive Operations</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">{getPanelTitle(panel)}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPanel(null)}
                    className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:border-cyan-300/25 hover:bg-cyan-400/10 hover:text-white"
                    aria-label="Close panel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {(panel === "search" || panel === "copilot") && ((workspaceLoading && !hasLiveWorkspaceData) || workspaceError) ? (
                  <div className="mt-4 rounded-2xl border border-cyan-300/10 bg-cyan-400/[0.05] px-4 py-3 text-sm text-slate-300">
                    {workspaceLoading && !hasLiveWorkspaceData ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
                        {getPanelLoadingLabel(panel)}
                      </span>
                    ) : workspaceError ? (
                      workspaceError
                    ) : null}
                  </div>
                ) : null}

                {panel === "search" ? (
                  <div className="mt-5">
                    <div className="flex items-center gap-3 rounded-2xl border border-cyan-400/15 bg-slate-950/55 px-4 py-3">
                      <Search className="h-4 w-4 text-cyan-200" />
                      <input
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search jobs, candidates, interviews, reports"
                        className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                      />
                      <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-400">Ctrl K</span>
                    </div>
                    <div className="mt-4 max-h-[48dvh] space-y-2 overflow-y-auto pr-1">
                      {searchItems.length === 0 ? (
                        <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-5 text-sm text-slate-400">
                          No matching workspace items.
                        </div>
                      ) : (
                        searchItems.map((item) => {
                          const Icon = item.icon;
                          const content = (
                            <>
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/10 bg-cyan-400/[0.07] text-cyan-100">
                                <Icon className="h-5 w-5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-white">{item.title}</span>
                                <span className="mt-1 block truncate text-xs text-slate-400">{item.type} - {item.meta}</span>
                              </span>
                              {item.score !== null && item.score !== undefined ? (
                                <span className="shrink-0 rounded-full border border-cyan-300/15 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-100">
                                  {Math.round(item.score)}%
                                </span>
                              ) : null}
                              <ArrowRight className="h-4 w-4 shrink-0 text-cyan-200/70" />
                            </>
                          );

                          if (item.action) {
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={item.action}
                                className="flex w-full items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-3 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/10"
                              >
                                {content}
                              </button>
                            );
                          }

                          if (!item.href) {
                            return null;
                          }

                          return (
                            <a
                              key={item.id}
                              href={item.href}
                              className="flex w-full items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-3 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/10"
                            >
                              {content}
                            </a>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}

                {panel === "alerts" ? (
                  <div className="mt-5 space-y-3">
                    {hasFlaggedCandidates ? (
                      alerts.slice(0, 5).map((alert, index) => (
                        <article key={alert.id ?? `${alert.title}-${index}`} className="rounded-2xl border border-rose-300/15 bg-rose-500/[0.07] p-4">
                          <p className="text-sm font-semibold text-rose-50">{alert.title || "Candidate integrity signal"}</p>
                          <p className="mt-2 text-sm leading-6 text-rose-100/75">{alert.message || "Review flagged candidate activity before advancing the workflow."}</p>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-cyan-300/10 bg-cyan-400/[0.06] p-4">
                        <p className="text-sm font-semibold text-cyan-50">No active review flags</p>
                        <p className="mt-2 text-sm leading-6 text-slate-300">Interview telemetry is quiet. New risk signals will surface here.</p>
                      </div>
                    )}
                  </div>
                ) : null}

                {panel === "copilot" ? (
                  <div className="mt-5 max-h-[56dvh] space-y-4 overflow-y-auto pr-1">
                    <div className="rounded-2xl border border-cyan-300/12 bg-cyan-400/[0.06] p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.14)]">
                          <Sparkles className="h-5 w-5" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-white">VERIS Copilot online</p>
                          <p className="mt-1 text-xs text-slate-400">Live recruiter guidance from jobs, interviews, candidates, and reports.</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {copilot.metrics.map((metric) => (
                        <div key={metric.label} className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{metric.label}</p>
                          <p className="mt-2 text-lg font-semibold text-white">{metric.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {copilot.priorities.map((item) => (
                        <article key={item.title} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-400/10 text-cyan-100">
                              {item.tone === "risk" ? <TriangleAlert className="h-4 w-4 text-rose-200" /> : <BrainCircuit className="h-4 w-4" />}
                            </span>
                            <div>
                              <p className={`text-sm font-semibold ${getDecisionTone(item.tone === "risk" ? "flagged" : "review")}`}>{item.title}</p>
                              <p className="mt-2 text-sm leading-6 text-slate-300">{item.body}</p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      {canSendInterview ? (
                      <button type="button" onClick={openSendInterview} className="rounded-2xl border border-cyan-300/15 bg-cyan-400/10 px-4 py-3 text-left text-sm font-semibold text-cyan-50 transition hover:border-cyan-300/30 hover:bg-cyan-400/15">
                        Send next invite
                      </button>
                      ) : null}
                      {canViewCandidates ? (
                      <a href={pageHref("/candidates")} className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-slate-200 transition hover:border-cyan-300/20 hover:bg-cyan-400/10">
                        Review queue
                      </a>
                      ) : null}
                      {canViewReports ? (
                      <a href={pageHref("/reports")} className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-slate-200 transition hover:border-cyan-300/20 hover:bg-cyan-400/10">
                        Open reports
                      </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
