"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";

import Navbar from "../components/Navbar";
import DashboardIntelligenceBanner from "../components/DashboardIntelligenceBanner";
import TrialStatusCard from "../components/TrialStatusCard";
import RecruiterDashboardBootstrap from "../components/RecruiterDashboardBootstrap";
import { VerisGlobeLoader } from "../components/system/loaders";
import { DEFAULT_RECRUITER_PERMISSION_PROFILE, canAccessFeature } from "../lib/client/permissions";
import { buildAuthUrl } from "../lib/client/auth-query";
import { useAuthSearchParams } from "../lib/client/use-auth-search-params";

const CognitiveDock = dynamic(() => import("../components/dashboard/CognitiveDock"), {
  ssr: false,
});

const Pipeline = dynamic(() => import("../components/Pipeline"), {
  ssr: false,
  loading: () => null,
});

const PendingInterviews = dynamic(() => import("../components/PendingInterviews"), {
  ssr: false,
  loading: () => null,
});

const RecordedInterviews = dynamic(() => import("../components/RecordedInterviews"), {
  ssr: false,
  loading: () => null,
});

const CandidateList = dynamic(() => import("../components/CandidateList"), {
  ssr: false,
  loading: () => null,
});

const Sidebar = dynamic(() => import("../components/Sidebar"), {
  ssr: false,
  loading: () => null,
});

const VerisSummary = dynamic(() => import("../components/VerisSummary"), {
  ssr: false,
  loading: () => null,
});

const WarRoomButton = dynamic(() => import("../components/WarRoomButton"), {
  ssr: false,
});

const SendInterviewModal = dynamic(() => import("../components/SendInterviewModal"), {
  ssr: false,
});

const EMPTY_PIPELINE = {
  pending: 0,
  inProgress: 0,
  completed: 0,
  flagged: 0,
  reviewed: 0,
  reviewRequired: 0,
};

const EMPTY_WORKFLOW_METRICS = {
  jobs: 0,
  activeJobs: 0,
  invites: 0,
  screeningRuns: 0,
  shortlistedCandidates: 0,
  screeningStarted: false,
  screeningCompleted: false,
  interviewsRunning: 0,
  completedInterviews: 0,
  pendingReports: 0,
  reviewedReports: 0,
  decisionsPending: 0,
};

function createEmptyDashboardOverview(profile = null) {
  return {
    partial: true,
    profile,
    pipeline: EMPTY_PIPELINE,
    workflowMetrics: EMPTY_WORKFLOW_METRICS,
    dashboardState: {},
    pendingInterviews: [],
    pendingInterviewsTotal: 0,
    candidates: [],
    alerts: [],
    trialCredits: null,
    recordedInterviews: [],
    veris: [],
  };
}

function normalizeDashboardOverview(overview) {
  if (!overview) {
    return null;
  }

  return {
    ...overview,
    pipeline: overview.pipeline ?? EMPTY_PIPELINE,
    workflowMetrics: overview.workflowMetrics ?? EMPTY_WORKFLOW_METRICS,
    dashboardState: overview.dashboardState ?? {},
    pendingInterviews: overview.pendingInterviews ?? [],
    pendingInterviewsTotal: overview.pendingInterviewsTotal ?? 0,
    candidates: overview.candidates ?? [],
  };
}

function mergeTrialCredits(current, incoming) {
  if (!incoming) {
    return current;
  }

  if (!current || incoming.source === "subscription" || current.source !== incoming.source) {
    return incoming;
  }

  return {
    ...incoming,
    interviewCreditsRemaining: Math.min(
      Number(current.interviewCreditsRemaining ?? incoming.interviewCreditsRemaining ?? 0),
      Number(incoming.interviewCreditsRemaining ?? current.interviewCreditsRemaining ?? 0)
    ),
    screeningCreditsRemaining: Math.min(
      Number(current.screeningCreditsRemaining ?? incoming.screeningCreditsRemaining ?? 0),
      Number(incoming.screeningCreditsRemaining ?? current.screeningCreditsRemaining ?? 0)
    ),
  };
}

function DashboardContent({ profile, overview, isLoading }) {
  const searchParams = useAuthSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const displayProfile = profile ?? overview?.profile ?? null;
  const permissionProfile = displayProfile?.permissions?.length ? displayProfile : DEFAULT_RECRUITER_PERMISSION_PROFILE;
  const fullOverview = normalizeDashboardOverview(overview) ?? createEmptyDashboardOverview(displayProfile);
  const isPartialOverview = Boolean(fullOverview?.partial);
  const [trialCredits, setTrialCredits] = useState(overview?.trialCredits ?? null);
  const activeInterviewCount = fullOverview?.pendingInterviewsTotal ?? fullOverview?.pendingInterviews?.length ?? 0;
  const candidateCount = fullOverview?.candidates?.length ?? 0;
  const canCreateJob = canAccessFeature(permissionProfile, "createJob");
  const canSendInterview = canAccessFeature(permissionProfile, "sendInterview");
  const canViewCandidates = canAccessFeature(permissionProfile, "candidates");
  const canViewInterviews = canAccessFeature(permissionProfile, "interviews");
  const canViewReports = canAccessFeature(permissionProfile, "reports");
  const canUseAiScreening = canAccessFeature(permissionProfile, "aiScreening");
  const canViewWarRoom = canAccessFeature(displayProfile, "warRoom");
  const fraudAlerts = (overview?.alerts ?? []).filter((alert) => {
    const text = `${alert?.tone ?? ""} ${alert?.type ?? ""} ${alert?.title ?? ""} ${alert?.message ?? ""}`.toLowerCase();
    return text.includes("danger") || text.includes("fraud") || text.includes("flag") || text.includes("suspicion") || text.includes("anomaly");
  });

  useEffect(() => {
    if (overview?.trialCredits) {
      const timer = window.setTimeout(() => {
        setTrialCredits((current) => mergeTrialCredits(current, overview.trialCredits));
      }, 0);

      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [overview?.trialCredits]);

  useEffect(() => {
    if (overview?.trialCredits || trialCredits) {
      return undefined;
    }

    let active = true;

    async function loadTrialCredits() {
      try {
        const response = await fetch(buildAuthUrl(`/api/trial-credits?refresh=${Date.now()}`, searchParams), {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);

        if (!active || !response.ok || !payload?.success) {
          return;
        }

        setTrialCredits((current) => mergeTrialCredits(current, payload.data));
      } catch (error) {
        console.warn("Failed to load trial credits from dashboard fallback", error);
      }
    }

    loadTrialCredits();

    return () => {
      active = false;
    };
  }, [overview?.trialCredits, searchParams, trialCredits]);

  useEffect(() => {
    function handleTrialCreditsUpdated(event) {
      if (event.detail) {
        setTrialCredits((current) => mergeTrialCredits(current, event.detail));
      }
    }

    window.addEventListener("hireveri:trial-credits-updated", handleTrialCreditsUpdated);
    return () => window.removeEventListener("hireveri:trial-credits-updated", handleTrialCreditsUpdated);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar onSendInterviewClick={() => setIsModalOpen(true)} initialProfile={displayProfile} initialAlerts={overview?.alerts} />
        <VerisGlobeLoader
          eyebrow="Dashboard"
          viewportOffset="navbar"
          steps={[
            { label: "Syncing dashboard", detail: "Loading hiring workflow, alerts, and workspace metrics." },
            { label: "Reading pipeline", detail: "Preparing candidate and interview activity." },
            { label: "Building overview", detail: "Assembling recruiter intelligence cards." },
            { label: "Dashboard ready", detail: "Your dashboard is ready for review." },
          ]}
          activeIndex={1}
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-950 text-white">
      <Navbar onSendInterviewClick={() => setIsModalOpen(true)} initialProfile={displayProfile} initialAlerts={overview?.alerts} />
      <CognitiveDock
        profile={displayProfile}
        activeInterviewCount={activeInterviewCount}
        candidateCount={candidateCount}
        flaggedCount={fraudAlerts.length}
        alerts={fraudAlerts}
        overview={fullOverview}
        onSendInterviewClick={() => setIsModalOpen(true)}
      />

      <div className="grid grid-cols-1 gap-6 p-4 sm:p-6 md:pl-28 lg:p-8 lg:pl-32 xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
        <div className="min-w-0">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Recruiter Dashboard</h1>
              <p className="mt-2 text-gray-400">
                Overview of interviews, candidates and hiring insights
              </p>
            </div>
          </div>

          <DashboardIntelligenceBanner
            overview={fullOverview}
            profile={displayProfile}
            onCreateJob={canCreateJob ? () => window.dispatchEvent(new CustomEvent("hireveri:open-create-job")) : undefined}
            onSendInterview={canSendInterview ? () => setIsModalOpen(true) : undefined}
          />
          <TrialStatusCard credits={trialCredits} />

          <Suspense fallback={null}>
            <Pipeline initialPipeline={fullOverview?.pipeline} isLoading={false} />
          </Suspense>
          {canViewInterviews ? (
          <Suspense fallback={null}>
            <PendingInterviews
              initialPendingInterviews={fullOverview?.pendingInterviews}
              initialPendingTotal={fullOverview?.pendingInterviewsTotal}
              profile={displayProfile}
              isLoading={false}
            />
          </Suspense>
          ) : null}
          {canViewInterviews || canViewReports ? (
          <Suspense fallback={null}>
            <RecordedInterviews
              initialRecordedInterviews={isPartialOverview ? undefined : fullOverview?.recordedInterviews}
              organizationId={displayProfile?.organizationId}
              profile={displayProfile}
              isLoading={false}
            />
          </Suspense>
          ) : null}
          {canViewCandidates ? (
          <Suspense fallback={null}>
            <CandidateList initialCandidates={fullOverview?.candidates} isLoading={false} />
          </Suspense>
          ) : null}
          {canUseAiScreening || canViewReports ? (
          <Suspense fallback={null}>
            <VerisSummary
              initialSummaries={isPartialOverview ? undefined : fullOverview?.veris}
              isLoading={false}
            />
          </Suspense>
          ) : null}
          {canViewWarRoom ? <WarRoomButton organizationId={displayProfile?.organizationId} /> : null}
        </div>

        <div className="min-w-0">
          <Sidebar initialProfile={displayProfile} overview={fullOverview} />
        </div>
      </div>

      {isModalOpen && canSendInterview ? <SendInterviewModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} initialTrialCredits={trialCredits} /> : null}
    </div>
  );
}

export default function Home() {
  return (
    <RecruiterDashboardBootstrap>
      {({ profile, overview, restoreStatus }) => (
        <DashboardContent
          profile={profile}
          overview={overview}
          isLoading={restoreStatus === "loading" && !overview}
        />
      )}
    </RecruiterDashboardBootstrap>
  );
}
