"use client";

import Link from "next/link";

import HorizontalWorkflow, { workflowActionClass } from "@/components/ui/HorizontalWorkflow";

// The VERIS Screening page's own run, in the Hiring Workflow style: resumes
// and the job, matching, then sending interview links to the shortlist --
// the step that hands off to the AI Interview.
const STEPS = [
  { id: "upload", number: 1, title: "Upload Resumes", description: "Drop PDF or DOCX resumes; VERIS parses them and captures emails." },
  { id: "job", number: 2, title: "Analyze Job", description: "Pick or create the job so VERIS extracts the skills that matter." },
  { id: "match", number: 3, title: "Run Matching", description: "Rank every candidate against the job with fit, risk and evidence." },
  { id: "send", number: 4, title: "Send Interview Link", description: "Invite your shortlist to the VERIS AI Interview in one step." },
];

function countLabel(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function getState({ resumesUploaded, resumeCount, jobSelected, jobAnalyzed, matched, matchedCount, strongFit, sentCount }) {
  const done = {
    upload: resumesUploaded,
    job: jobAnalyzed,
    match: matched,
    send: sentCount > 0,
  };
  const completedCount = Object.values(done).filter(Boolean).length;
  // A restored run can have resumes on record without the upload rows in
  // memory, so the count is only quoted when it is actually known.
  const resumesReady = resumeCount > 0 ? `${countLabel(resumeCount, "resume is", "resumes are")} ready.` : "Resumes are ready.";
  const resumesChip = resumeCount > 0 ? countLabel(resumeCount, "resume", "resumes") : "Resumes ready";

  if (!done.upload) {
    return {
      activeId: "upload",
      done,
      completedCount,
      recommendation: jobAnalyzed
        ? "The job is analyzed. Upload resumes to match candidates against it."
        : "Upload resumes and choose a job to start VERIS Screening.",
      chip: "Start here",
      target: "resumes",
      cta: "Upload Resumes",
    };
  }

  if (!done.job) {
    return {
      activeId: "job",
      done,
      completedCount,
      recommendation: jobSelected
        ? `${resumesReady} Analyze the job description next.`
        : `${resumesReady} Select or create the job, then analyze it.`,
      chip: resumesChip,
      target: "job",
      cta: "Analyze Job",
    };
  }

  if (!done.match) {
    return {
      activeId: "match",
      done,
      completedCount,
      recommendation: "Resumes and the job are ready. Run matching to rank your candidates.",
      chip: resumesChip,
      target: "job",
      cta: "Run Matching",
    };
  }

  if (!done.send) {
    return {
      activeId: "send",
      done,
      completedCount,
      recommendation: `${countLabel(matchedCount, "candidate", "candidates")} ranked, ${strongFit} strong fit. Send interview links to your shortlist.`,
      chip: `${matchedCount} matched`,
      target: "results",
      cta: "Send Interview Links",
    };
  }

  return {
    activeId: "send",
    done,
    completedCount,
    recommendation: `${countLabel(sentCount, "interview link", "interview links")} sent. Track who starts and finishes in Interviews.`,
    chip: `${sentCount} sent`,
    target: null,
    cta: "View Interviews",
  };
}

/**
 * @param {{
 *   resumesUploaded?: boolean,
 *   resumeCount?: number,
 *   jobSelected?: boolean,
 *   jobAnalyzed?: boolean,
 *   matched?: boolean,
 *   matchedCount?: number,
 *   strongFit?: number,
 *   sentCount?: number,
 *   busyStep?: "upload" | "job" | "match" | "send" | null,
 *   onGoTo?: (target: "resumes" | "job" | "results") => void,
 *   interviewsHref?: string,
 *   className?: string,
 * }} props
 */
export default function ScreeningWorkflow({
  resumesUploaded = false,
  resumeCount = 0,
  jobSelected = false,
  jobAnalyzed = false,
  matched = false,
  matchedCount = 0,
  strongFit = 0,
  sentCount = 0,
  busyStep = null,
  onGoTo,
  interviewsHref = "/interviews",
  className = "",
}) {
  const state = getState({ resumesUploaded, resumeCount, jobSelected, jobAnalyzed, matched, matchedCount, strongFit, sentCount });
  const allDone = state.completedCount === STEPS.length;

  const steps = STEPS.map((step) => {
    const isActive = state.activeId === step.id;
    return {
      ...step,
      // The last step stays the "Now" step once links are out, like the
      // dashboard's final Hiring Decision step, but reads as done.
      status: isActive ? "active" : state.done[step.id] ? "completed" : "pending",
      statusLabel: busyStep === step.id ? "In progress" : isActive && allDone ? "Sent" : undefined,
    };
  });
  const action =
    busyStep === state.activeId ? null : state.target ? (
      <button type="button" onClick={() => onGoTo?.(state.target)} className={workflowActionClass}>
        {state.cta}
      </button>
    ) : (
      <Link href={interviewsHref} className={workflowActionClass}>
        {state.cta}
      </Link>
    );

  return (
    <HorizontalWorkflow
      className={className}
      theme="cyan"
      eyebrow="Screening Workflow · VERIS Recommendation"
      recommendation={state.recommendation}
      chips={[
        { label: `${state.completedCount} of ${STEPS.length} steps completed` },
        { label: state.chip, tone: "muted" },
      ]}
      steps={steps}
      action={action}
    />
  );
}
