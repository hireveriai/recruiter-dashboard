"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  Link2,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldAlert,
  SquarePlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

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

type VerisAiCard = {
  title: string;
  body: string;
  meta?: string;
  href?: string;
  tone?: "cyan" | "emerald" | "amber" | "rose";
};

type VerisAiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards?: VerisAiCard[];
  sources?: string[];
};

function getPanelTitle(panel: PanelMode) {
  if (panel === "search") return "Universal Search";
  if (panel === "alerts") return "Review Flags";
  if (panel === "copilot") return "VERIS AI";
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
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessages, setAiMessages] = useState<VerisAiMessage[]>([]);
  const workspaceRef = useRef(workspace);

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

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const openCreateJob = useCallback(() => {
    window.dispatchEvent(new CustomEvent("verisnova:open-create-job"));
    setPanel(null);
  }, []);

  const openSendInterview = useCallback(() => {
    onSendInterviewClick?.();
    setPanel(null);
  }, [onSendInterviewClick]);

  useEffect(() => {
    function handleOpenCopilot() {
      setPanel("copilot");
    }

    window.addEventListener("verisnova:open-copilot", handleOpenCopilot);
    return () => window.removeEventListener("verisnova:open-copilot", handleOpenCopilot);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("openCopilot") === "1") {
      setPanel("copilot");
      params.delete("openCopilot");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

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

      if (hasWorkspaceData(mergeWorkspaceData(workspaceRef.current, overviewWorkspace))) {
        setWorkspace((current) => mergeWorkspaceData(current, overviewWorkspace));
      }

      setWorkspaceLoading(!hasWorkspaceData(mergeWorkspaceData(workspaceRef.current, overviewWorkspace)));
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
        meta: "Open evidence analytics and decision trends",
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

  const aiStartingPoints = useMemo(() => [
    {
      title: "Review candidates",
      description: "Find top candidates and items needing attention.",
      prompt: "Show candidates who need my attention",
      icon: Users,
      tone: "from-cyan-400/20 to-blue-500/5",
    },
    {
      title: "Interview operations",
      description: "Surface interrupted, pending, and completed interviews.",
      prompt: "Show interrupted interviews",
      icon: ClipboardList,
      tone: "from-amber-400/20 to-orange-500/5",
    },
    {
      title: "Pipeline intelligence",
      description: "Summarize jobs, scores, and recruiter priorities.",
      prompt: "Give me a pipeline summary",
      icon: BarChart3,
      tone: "from-emerald-400/20 to-teal-500/5",
    },
    {
      title: "Team access",
      description: "Learn how to add users, roles, and permissions.",
      prompt: "How do I add users and give them access?",
      icon: ShieldAlert,
      tone: "from-violet-400/20 to-fuchsia-500/5",
    },
  ], []);

  const buildAiReply = useCallback((question: string): VerisAiMessage => {
    const normalized = normalizeSearch(question);
    const candidates = workspace.candidates;
    const interviews = workspace.interviews;
    const jobs = workspace.jobs;
    const candidateName = (item: Record<string, unknown>) => readText(item.candidateName ?? item.fullName ?? item.name, "Candidate");
    const jobName = (item: Record<string, unknown>) => readText(item.jobTitle ?? item.job_title, "Unassigned role");
    const scoreFor = (item: Record<string, unknown>) => readNumber(item.score ?? item.verisScreeningScore);
    const makeId = () => `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (/(fixed|scheduled).*(flexible)|(flexible).*(fixed|scheduled)|difference.*schedule|interview access type/.test(normalized)) {
      return {
        id: makeId(),
        role: "assistant",
        content: "**Flexible access** lets the candidate open the interview at a convenient time during a **24-hour access window**. A **fixed schedule** limits access to the specific start and end time selected by the recruiter.",
        cards: [
          {
            title: "Flexible access",
            body: "Best when candidates should choose their own interview time. The invitation remains available during its 24-hour access window.",
            meta: "More candidate flexibility · Less scheduling coordination",
            tone: "cyan",
          },
          {
            title: "Fixed schedule",
            body: "Best when the interview must happen within a controlled period. The recruiter sets the exact start and end time.",
            meta: "Precise timing · Useful for coordinated or time-sensitive interviews",
            tone: "amber",
          },
        ],
        sources: ["Interview access settings", "Candidate invitations"],
      };
    }

    if (/(how.*interview|interview.*flow|interview.*work|start.*end|candidate journey|send.*interview)/.test(normalized)) {
      return {
        id: makeId(),
        role: "assistant",
        content: "The interview lifecycle runs from recruiter setup through evidence review. **Candidate answers and recordings are saved progressively**, so a temporary failure should not erase the completed portion. Recruiters remain responsible for the final hiring decision.",
        cards: [
          { title: "1. Configure the role", body: "Create the job with skills, experience, interview settings, and allowed devices. VERIS Screening can analyze resumes before invitations are sent.", meta: "Recruiter · Jobs / VERIS Screening", href: pageHref("/jobs"), tone: "cyan" },
          { title: "2. Select and invite", body: "Choose candidates, review duplicate invitations, skip previously invited candidates if needed, then use flexible access or a fixed schedule.", meta: "Flexible access is configured as a 24-hour window", href: canViewCandidates ? pageHref("/candidates") : undefined, tone: "cyan" },
          { title: "3. Prepare questions", body: "The interview question set is prepared from the role requirements and available resume evidence, with safeguards for retries and regenerated attempts.", meta: "Job-based, resume-based, and behavioral signal", tone: "emerald" },
          { title: "4. Candidate preflight", body: "The candidate opens the secure link and completes camera, microphone, device, connection, and attention checks before the interview begins.", meta: "Candidate interview room", tone: "emerald" },
          { title: "5. Conduct the interview", body: "VERIS presents questions one by one while recording the session. Responses, transcript evidence, and progress are stored during the interview.", meta: "Candidate can move forward when the current step is safely finalized", tone: "amber" },
          { title: "6. Complete and evaluate", body: "After the final answer, the attempt is finalized and the recruiter receives status, score, summary, recording, transcript, and integrity evidence when available.", meta: "Recruiter · Interviews and Reports", href: canViewInterviews ? pageHref("/interviews") : undefined, tone: "emerald" },
          { title: "7. Handle an interruption", body: "Technical interruptions appear for recruiter review. Eligible attempts below the recovery threshold can receive a controlled recovery link instead of silently restarting everything.", meta: "Recovery is single-use, recruiter-controlled, and time limited", href: canViewInterviews ? pageHref("/interviews") : undefined, tone: "rose" },
          { title: "8. Make the hiring decision", body: "Review the complete evidence, record the decision, and take the next hiring action. VERIS provides decision support but does not automatically hire or reject.", meta: "Human decision required", href: canViewReports ? pageHref("/reports") : undefined, tone: "cyan" },
        ],
        sources: ["Jobs", "VERIS Screening", "Interview workflow", "Recovery policy", "Reports"],
      };
    }

    if (/(add.*user|add.*member|team access|manage team|role.*permission|permission.*role|invite.*recruiter|user.*access|disable.*user|remove.*user)/.test(normalized)) {
      return {
        id: makeId(),
        role: "assistant",
        content: "Team access is managed through **Manage Team** using organization roles plus per-user permission controls. Only an authorized administrator should grant or change access, and users receive only the features included in their effective permissions.",
        cards: [
          { title: "1. Open Manage Team", body: "Go to Manage Team and choose Add User. Enter the recruiter’s full name and email address.", meta: "Administrator access required", href: pageHref("/manage-team"), tone: "cyan" },
          { title: "2. Assign an organization role", body: "Select the appropriate organization role. Its default permission set is applied automatically as the starting point.", meta: "Use least-privilege access", href: pageHref("/manage-team"), tone: "emerald" },
          { title: "3. Review exact permissions", body: "Add or remove individual permissions before sending the invite. These permissions control access to jobs, candidates, interviews, reports, billing, alerts, and administrative features.", meta: "Role defaults can be adjusted per member", href: pageHref("/manage-team"), tone: "amber" },
          { title: "4. Send the access invitation", body: "Submitting the user creates a pending membership and emails a secure access link. The current invitation window is 72 hours.", meta: "Pending invites can be resent", href: pageHref("/manage-team"), tone: "cyan" },
          { title: "5. User accepts and signs in", body: "The invited user opens the secure link, completes access setup, and enters the organization workspace with their assigned role and permissions.", meta: "Access is organization-scoped", tone: "emerald" },
          { title: "6. Maintain access", body: "Administrators can edit the role and exact permissions, resend an invitation, temporarily disable or re-enable access, or remove the member from the organization.", meta: "Changes take effect through the member’s effective permission profile", href: pageHref("/manage-team"), tone: "rose" },
        ],
        sources: ["Manage Team", "Organization roles", "Permission catalog", "Access invitations"],
      };
    }

    if (/(interrupt|network|stuck|halt|expired|exited|break)/.test(normalized)) {
      const affected = interviews.filter((item) =>
        /(interrupt|network|stuck|halt|expired|exited|abandon|heartbeat)/.test(
          normalizeSearch(`${item.status} ${item.interruptionReason} ${item.reason} ${item.errorMessage}`),
        ),
      ).slice(0, 6);
      return {
        id: makeId(),
        role: "assistant",
        content: affected.length
          ? `I found **${affected.length} interview${affected.length === 1 ? "" : "s"}** with interruption-related signals in the currently loaded workspace. Review the evidence before resending an invite.`
          : "I could not find an interruption-related interview in the currently loaded workspace. The interview queue may still contain older records outside this live snapshot.",
        cards: affected.map((item) => ({
          title: candidateName(item),
          body: `${jobName(item)} · ${readText(item.status, "Status unavailable")}`,
          meta: readText(item.interruptionReason ?? item.reason ?? item.errorMessage, "Open the interview for session evidence"),
          href: canViewInterviews ? pageHref("/interviews") : undefined,
          tone: "rose",
        })),
        sources: ["Interviews"],
      };
    }

    if (/(top|best|high score|shortlist|compare)/.test(normalized)) {
      const ranked = [...candidates]
        .filter((item) => scoreFor(item) !== null)
        .sort((a, b) => (scoreFor(b) ?? 0) - (scoreFor(a) ?? 0))
        .slice(0, 5);
      return {
        id: makeId(),
        role: "assistant",
        content: ranked.length
          ? `Here are the **top ${ranked.length} candidates by visible score**. Treat the score as one signal and review interview evidence before deciding.`
          : "No scored candidates are visible in the current workspace snapshot yet.",
        cards: ranked.map((item) => ({
          title: candidateName(item),
          body: jobName(item),
          meta: `${Math.round(scoreFor(item) ?? 0)}% · ${readText(item.status, "Pipeline")}`,
          href: canViewCandidates ? pageHref("/candidates") : undefined,
          tone: "emerald",
        })),
        sources: ["Candidates", "VERIS scores"],
      };
    }

    if (/(flag|risk|integrity|attention|review)/.test(normalized)) {
      const flagged = candidates.filter((item) =>
        /(flag|risk|review|concern)/.test(normalizeSearch(`${item.status} ${item.decision} ${item.aiSummaryFull} ${item.riskLevel}`)),
      ).slice(0, 6);
      return {
        id: makeId(),
        role: "assistant",
        content: flagged.length
          ? `I found **${flagged.length} candidate${flagged.length === 1 ? "" : "s"}** with review or integrity signals. These are review prompts, not automatic rejection decisions.`
          : "No candidate review flags are visible in the current workspace snapshot.",
        cards: flagged.map((item) => ({
          title: candidateName(item),
          body: jobName(item),
          meta: readText(item.decision ?? item.status ?? item.riskLevel, "Review evidence"),
          href: canViewCandidates ? pageHref("/candidates") : undefined,
          tone: "amber",
        })),
        sources: ["Candidates", "Integrity signals"],
      };
    }

    if (/(job|role|opening)/.test(normalized)) {
      const active = jobs.filter((item) => item.isActive !== false).slice(0, 6);
      return {
        id: makeId(),
        role: "assistant",
        content: `There are **${active.length} active role${active.length === 1 ? "" : "s"}** in the loaded workspace${jobs.length > active.length ? " (showing the first six)" : ""}.`,
        cards: active.map((item) => ({
          title: jobName(item),
          body: Array.isArray(item.coreSkills) ? item.coreSkills.slice(0, 4).join(" · ") : "Role configuration",
          meta: `${readNumber((item._count as Record<string, unknown> | undefined)?.interviews) ?? 0} interviews`,
          href: pageHref("/jobs"),
          tone: "cyan",
        })),
        sources: ["Jobs"],
      };
    }

    const exactCandidates = candidates.filter((item) => normalized.length > 2 && normalizeSearch(candidateName(item)).includes(normalized)).slice(0, 4);
    if (exactCandidates.length) {
      return {
        id: makeId(),
        role: "assistant",
        content: `I found **${exactCandidates.length} matching candidate record${exactCandidates.length === 1 ? "" : "s"}**.`,
        cards: exactCandidates.map((item) => ({
          title: candidateName(item),
          body: jobName(item),
          meta: [scoreFor(item) === null ? null : `${Math.round(scoreFor(item) ?? 0)}%`, readText(item.status, "Pipeline")].filter(Boolean).join(" · "),
          href: canViewCandidates ? pageHref("/candidates") : undefined,
          tone: "cyan",
        })),
        sources: ["Candidates"],
      };
    }

    const metricSummary = copilot.metrics.map((metric) => `**${metric.label}:** ${metric.value}`).join(" · ");
    return {
      id: makeId(),
      role: "assistant",
      content: `Here is the live workspace snapshot: ${metricSummary}\n\nMy recommended first action: **${copilot.priorities[0]?.title ?? "review the interview queue"}**. You can also ask me for top candidates, interrupted interviews, review flags, or active jobs.`,
      cards: copilot.priorities.slice(0, 3).map((item) => ({ title: item.title, body: item.body, tone: item.tone === "risk" ? "rose" : "cyan" })),
      sources: ["Jobs", "Candidates", "Interviews", "Reports"],
    };
  }, [workspace, copilot, canViewCandidates, canViewInterviews, canViewReports, pageHref]);

  const askVerisAi = useCallback((question: string) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || aiBusy) return;

    setAiMessages((current) => [...current, {
      id: `user-${Date.now()}`,
      role: "user",
      content: cleanQuestion,
    }]);
    setAiInput("");
    setAiBusy(true);
    window.setTimeout(() => {
      setAiMessages((current) => [...current, buildAiReply(cleanQuestion)]);
      setAiBusy(false);
    }, 260);
  }, [aiBusy, buildAiReply]);

  const startNewAiChat = useCallback(() => {
    setAiMessages([]);
    setAiInput("");
    setAiBusy(false);
  }, []);

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
        canUseCopilot ? { label: "VERIS AI", icon: BrainCircuit, onClick: () => setPanel("copilot"), active: panel === "copilot", featured: true } : null,
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
        aria-label="Interview Operations Dock"
      >
        <div className="hv-preserve-dark relative rounded-[32px] border border-white/5 bg-[#081120]/72 p-2.5 shadow-[0_18px_60px_rgba(2,6,23,0.36),0_0_34px_rgba(34,211,238,0.09)] backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.01)_38%,transparent),radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.105),transparent_46%)]" />
          <motion.nav
            className="relative flex max-w-[calc(100vw-2rem)] items-center gap-1.5 overflow-x-auto md:max-h-[calc(100dvh-8rem)] md:w-[52px] md:max-w-none md:flex-col md:gap-2 md:overflow-visible md:py-1 xl:w-14"
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
            className="hv-theme-dialog-backdrop fixed inset-0 z-[65] bg-slate-950/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPanel(null)}
          >
            <motion.section
              role="dialog"
              aria-label={getPanelTitle(panel)}
            className={`hv-cognitive-modal hv-theme-modal absolute bottom-24 left-1/2 max-h-[min(84dvh,820px)] -translate-x-1/2 overflow-hidden rounded-[24px] border border-cyan-400/15 bg-[#071226]/95 p-4 text-white shadow-[0_24px_80px_rgba(2,6,23,0.58),0_0_42px_rgba(34,211,238,0.09)] backdrop-blur-2xl md:bottom-auto md:left-24 md:top-1/2 md:translate-x-0 md:-translate-y-1/2 ${panel === "copilot" ? "!bottom-auto !top-1/2 h-[min(80dvh,700px)] !max-h-[min(80dvh,700px)] !-translate-y-1/2 w-[min(92vw,980px)] md:w-[min(calc(100vw-8rem),980px)]" : "w-[min(92vw,640px)]"}`}
              initial={{ opacity: 0, x: -10, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -10, scale: 0.97 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.13),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]" />
              <div className={`relative ${panel === "copilot" ? "flex h-full min-h-0 flex-col" : ""}`}>
                {panel !== "copilot" ? <div className="flex shrink-0 items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-white">{getPanelTitle(panel)}</h2>
                    <p className="mt-0.5 text-[10px] text-slate-400">Interview operations intelligence</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPanel(null)}
                      className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:border-cyan-300/25 hover:bg-cyan-400/10 hover:text-white"
                      aria-label="Close panel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div> : (
                  <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
                    {aiMessages.length ? (
                      <button type="button" onClick={startNewAiChat} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d192c]/90 px-3 py-2 text-xs font-semibold text-slate-300 backdrop-blur transition hover:border-cyan-300/25 hover:bg-cyan-400/10 hover:text-white">
                        <RefreshCw className="h-3.5 w-3.5" /> New chat
                      </button>
                    ) : null}
                    <button type="button" onClick={() => setPanel(null)} className="rounded-xl border border-white/10 bg-[#0d192c]/90 p-2 text-slate-300 backdrop-blur transition hover:border-cyan-300/25 hover:bg-cyan-400/10 hover:text-white" aria-label="Close panel">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

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
                  <div className="hv-copilot-shell grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/8 bg-[#050d1b]/65 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <aside className="hv-copilot-sidebar hidden min-h-0 overflow-hidden border-r border-white/8 bg-white/[0.025] p-3 lg:block">
                      <div className="flex items-center gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.07] p-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/25 bg-[linear-gradient(135deg,rgba(8,145,178,0.22),rgba(56,189,248,0.1))] text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.14)]"><BrainCircuit className="h-5 w-5" strokeWidth={2} /></span>
                        <div className="min-w-0"><p className="text-sm font-semibold text-white">VERIS AI online</p><p className="mt-1 whitespace-nowrap text-[10px] text-slate-400">Live workspace intelligence</p></div>
                      </div>
                      <p className="mb-2 mt-4 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-500">Try asking</p>
                      <div className="space-y-1.5">
                        {aiStartingPoints.map(({ title, prompt, icon: Icon }) => (
                          <button key={title} type="button" onClick={() => askVerisAi(prompt)} className="group flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2.5 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/[0.08]">
                            <Icon className="h-4 w-4 shrink-0 text-cyan-200/70 transition group-hover:text-cyan-100" />
                            <span className="text-xs font-medium text-slate-300 group-hover:text-white">{title}</span>
                            <ArrowRight className="ml-auto h-3.5 w-3.5 text-slate-600" />
                          </button>
                        ))}
                      </div>
                    </aside>

                    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                      {aiMessages.length === 0 ? (
                        <div className="flex flex-1 flex-col overflow-y-auto px-5 py-3 sm:overflow-hidden sm:px-6">
                          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-start pt-2">
                            <div className="text-center">
                              <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-cyan-100"><BrainCircuit className="h-4 w-4" /></span>
                              <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">How can I help today?</h3>
                              <p className="mx-auto mt-1.5 max-w-xl text-xs leading-5 text-slate-400">Ask about candidates, interviews, jobs, review signals, or pipeline priorities. Answers use the recruiter data you are permitted to see.</p>
                            </div>
                            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                              {aiStartingPoints.slice(0, 3).map(({ title, description, prompt, icon: Icon, tone }) => (
                                <button key={title} type="button" onClick={() => askVerisAi(prompt)} className={`group flex h-[148px] min-w-0 flex-col rounded-xl border border-white/8 bg-gradient-to-br ${tone} p-3 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/25`}>
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-slate-950/35 text-cyan-100"><Icon className="h-3.5 w-3.5" /></span>
                                  <p className="mt-2 truncate text-sm font-semibold text-white">{title}</p>
                                  <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-slate-400">{description}</p>
                                  <ArrowRight className="mt-auto h-3.5 w-3.5 shrink-0 text-cyan-200/60 transition group-hover:translate-x-1 group-hover:text-cyan-100" />
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Conversation className="min-h-0 flex-1">
                          <ConversationContent className="gap-5 px-5 py-6 sm:px-7">
                            {aiMessages.map((message) => (
                              <Message key={message.id} from={message.role}>
                                <MessageContent className={message.role === "assistant" ? "w-full" : undefined}>
                                  {message.role === "assistant" ? <MessageResponse>{message.content}</MessageResponse> : <p>{message.content}</p>}
                                  {message.cards?.length ? (
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                      {message.cards.map((card, index) => {
                                        const tone = card.tone === "rose" ? "border-rose-300/15 bg-rose-400/[0.06]" : card.tone === "amber" ? "border-amber-300/15 bg-amber-400/[0.06]" : card.tone === "emerald" ? "border-emerald-300/15 bg-emerald-400/[0.06]" : "border-cyan-300/15 bg-cyan-400/[0.06]";
                                        const cardContent = <><div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-950/30"><CheckCircle2 className="h-4 w-4 text-cyan-100" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{card.title}</p><p className="mt-1 text-xs leading-5 text-slate-300">{card.body}</p>{card.meta ? <p className="mt-2 text-[11px] leading-4 text-slate-500">{card.meta}</p> : null}</div></div></>;
                                        return card.href ? <a key={`${card.title}-${index}`} href={card.href} className={`rounded-2xl border p-3 transition hover:border-cyan-300/30 ${tone}`}>{cardContent}</a> : <article key={`${card.title}-${index}`} className={`rounded-2xl border p-3 ${tone}`}>{cardContent}</article>;
                                      })}
                                    </div>
                                  ) : null}
                                  {message.sources?.length ? <p className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500"><FileSearch className="h-3 w-3" /> Sources: {message.sources.join(" · ")}</p> : null}
                                </MessageContent>
                              </Message>
                            ))}
                            {aiBusy ? <Message from="assistant"><MessageContent><span className="inline-flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin text-cyan-200" /> Reading workspace signals...</span></MessageContent></Message> : null}
                          </ConversationContent>
                          <ConversationScrollButton className="border-cyan-300/20 bg-[#0b1729] text-cyan-100" />
                        </Conversation>
                      )}

                      <div className="hv-copilot-composer shrink-0 border-t border-white/8 bg-[#071226]/95 px-3 py-2.5">
                        <Suggestions className="mb-2 flex-nowrap overflow-x-auto">
                          {["How interviews work", "Add users and access", "Interrupted interviews", "Top candidates"].map((suggestion) => (
                            <Suggestion key={suggestion} suggestion={suggestion} onClick={askVerisAi} className="border-white/10 bg-white/[0.035] text-slate-300 hover:border-cyan-300/25 hover:bg-cyan-400/10 hover:text-white" />
                          ))}
                        </Suggestions>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (aiInput.trim() && !aiBusy) askVerisAi(aiInput);
                          }}
                          className="flex h-12 items-center gap-2 rounded-xl border border-cyan-300/20 bg-white/[0.04] px-3 shadow-[0_0_20px_rgba(34,211,238,0.05)] focus-within:border-cyan-300/40"
                        >
                          <input
                            value={aiInput}
                            onChange={(event) => setAiInput(event.target.value)}
                            placeholder="Ask VERIS AI about your hiring workspace..."
                            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                          />
                          <button type="submit" disabled={!aiInput.trim() || aiBusy} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-300 text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Send message">
                            {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                          </button>
                        </form>
                        <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[9px] text-slate-600"><MessageSquareText className="h-3 w-3" /> Enter to send · VERIS AI summarizes visible workspace data.</p>
                      </div>
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
