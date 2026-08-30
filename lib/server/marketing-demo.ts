const DEMO_NOW = "2026-08-01T10:30:00.000Z"
const ORG_ID = "11111111-1111-4111-8111-111111111111"
const USER_ID = "22222222-2222-4222-8222-222222222222"
const JOB_ID = "33333333-3333-4333-8333-333333333333"

const profile = {
  name: "Aarav Mehta",
  email: "demo.recruiter@example.invalid",
  organization: "Acme Technologies",
  timezone: "Asia/Kolkata",
  timezoneLabel: "India Standard Time",
  userId: USER_ID,
  organizationId: ORG_ID,
  recruiterRoleId: 1,
  permissions: [
    "ai.use",
    "alerts.view",
    "billing.view",
    "candidates.invite",
    "candidates.view",
    "interviews.create",
    "interviews.edit",
    "interviews.delete",
    "organization.settings",
    "reports.view",
    "users.manage",
    "warroom.view",
    "warroom.analyze",
  ],
  isAdmin: true,
  recruiterProfileExists: true,
  sessionCookieMatched: true,
  sessionValidatedVia: "marketing_demo",
}

// Roles here are deliberately spread across industries and functions. VerisNova
// builds an interview from a role's requirements rather than assuming a
// technical role, and these fixtures are what public marketing screenshots
// show, so they should not read as an engineering-only product.
const jobs = [
  {
    jobId: JOB_ID,
    jobTitle: "Regional Operations Manager",
    jobDescription: "Lead regional service operations, own performance targets, and develop frontline team capability across multiple sites.",
    experienceLevelId: 4,
    difficultyProfile: "ADVANCED",
    interviewDurationMinutes: 45,
    questionTypeDefault: "MIXED",
    deviceRequirement: "ANY",
    coreSkills: ["Team Leadership", "Service Operations", "Budget Ownership", "Stakeholder Management"],
    interviewMode: "STANDARD",
    codingRequired: "NO",
    codingAssessmentType: null,
    codingDifficulty: null,
    codingDurationMinutes: null,
    codingLanguages: [],
    isActive: true,
    _count: { interviews: 12 },
  },
  {
    jobId: "44444444-4444-4444-8444-444444444444",
    jobTitle: "Clinical Nurse Manager",
    jobDescription: "Oversee ward staffing, uphold patient care standards, and support clinical teams through escalation and review.",
    experienceLevelId: 3,
    difficultyProfile: "INTERMEDIATE",
    interviewDurationMinutes: 40,
    questionTypeDefault: "BEHAVIORAL",
    deviceRequirement: "ANY",
    coreSkills: ["Patient Care Standards", "Clinical Governance", "Rostering", "Team Development"],
    interviewMode: "INDIVIDUALIZED",
    codingRequired: "NO",
    codingAssessmentType: null,
    codingDifficulty: null,
    codingDurationMinutes: null,
    codingLanguages: [],
    isActive: true,
    _count: { interviews: 8 },
  },
  {
    jobId: "4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b",
    jobTitle: "Enterprise Account Executive",
    jobDescription: "Own complex enterprise sales cycles end to end, from qualification through negotiation and close.",
    experienceLevelId: 4,
    difficultyProfile: "ADVANCED",
    interviewDurationMinutes: 45,
    questionTypeDefault: "MIXED",
    deviceRequirement: "ANY",
    coreSkills: ["Consultative Selling", "Pipeline Management", "Negotiation", "Forecasting"],
    interviewMode: "STANDARD",
    codingRequired: "NO",
    codingAssessmentType: null,
    codingDifficulty: null,
    codingDurationMinutes: null,
    codingLanguages: [],
    isActive: true,
    _count: { interviews: 6 },
  },
]

// Order matters: the first three rows are what the candidate list shows above
// the fold, so they deliberately span all three roles. Index positions are also
// load-bearing further down (index 2 is the INVITED candidate with no start
// time, indexes 0 and 4 are the completed ones, index 3 is mid-interview).
const candidates = [
  ["Ishita Rao", "Regional Operations Manager", "COMPLETED", 91, "STRONG_HIRE"],
  ["Arjun Bose", "Enterprise Account Executive", "REVIEW_REQUIRED", 84, "REVIEW"],
  ["Mira Nair", "Clinical Nurse Manager", "INVITED", 79, "PENDING"],
  ["Kabir Shah", "Regional Operations Manager", "IN_PROGRESS", 87, "PENDING"],
  ["Nyla Kapoor", "Clinical Nurse Manager", "COMPLETED", 82, "HIRE"],
].map((row, index) => ({
  candidateId: `55555555-5555-4555-8${String(index + 1).padStart(3, "0")}-555555555555`,
  interviewId: `66666666-6666-4666-8${String(index + 1).padStart(3, "0")}-666666666666`,
  attemptId: `77777777-7777-4777-8${String(index + 1).padStart(3, "0")}-777777777777`,
  candidateName: row[0],
  jobTitle: row[1],
  status: row[2],
  score: row[3],
  verisScreeningScore: row[3],
  aiSummaryShort: "Structured evidence shows strong role alignment and clear, measured communication.",
  aiSummaryFull: "The candidate worked through realistic scenarios methodically, explained trade-offs clearly, and connected their decisions to measurable outcomes. Human review remains the final decision point.",
  decision: row[4],
  recruiterDecisionStatus: null,
  recruiterDecisionAt: null,
  recruiterDecisionNotes: null,
  accessType: "FLEXIBLE",
  startTime: null,
  endTime: null,
  expiresAt: "2026-08-08T10:30:00.000Z",
  startedAt: index === 2 ? null : "2026-08-01T09:15:00.000Z",
  endedAt: index === 0 || index === 4 ? "2026-08-01T10:02:00.000Z" : null,
  createdAt: DEMO_NOW,
  answerSummaries: [],
}))

const recordings = candidates.slice(0, 2).map((candidate, index) => ({
  recordingId: `88888888-8888-4888-8${String(index + 1).padStart(3, "0")}-888888888888`,
  attemptId: candidate.attemptId,
  candidateName: candidate.candidateName,
  jobTitle: candidate.jobTitle,
  recordingUrl: "",
  audioUrl: "",
  storagePath: null,
  hasRecordingFile: false,
  transcriptPreview: "I would weigh service impact, cost, team capacity and recovery options against one shared decision framework.",
  transcriptReady: true,
  cognitiveAnalysisReady: true,
  aiSummaryPreview: "Clear reasoning with strong ownership and practical risk awareness.",
  retentionDays: 30,
  expiresAt: "2026-08-31T10:30:00.000Z",
  createdAt: DEMO_NOW,
}))

const veris = candidates.slice(0, 3).map((candidate, index) => ({
  candidateName: candidate.candidateName,
  jobTitle: candidate.jobTitle,
  interviewId: candidate.interviewId,
  attemptId: candidate.attemptId,
  attemptStatus: index === 2 ? "INVITED" : "COMPLETED",
  startedAt: candidate.startedAt,
  endedAt: candidate.endedAt,
  riskLevel: index === 1 ? "MEDIUM" : "LOW",
  recommendation: index === 0 ? "STRONG HIRE" : index === 1 ? "REVIEW RECOMMENDED" : "PROCEED",
  recommendationReason: "Evidence supports progression; final decision remains recruiter controlled.",
  scoreLabel: `${candidate.score}%`,
  strengthsShort: "Structured judgment, clear trade-offs, calm communication",
  weaknessesShort: index === 1 ? "Probe deeper on escalation ownership" : "Validate resourcing assumptions in follow-up",
  behavioralFlagsShort: index === 1 ? "Integrity signal: brief attention shift; review context" : "No material integrity concerns",
}))

const pipeline = { pending: 7, inProgress: 3, completed: 18, flagged: 2, reviewed: 14, reviewRequired: 4 }
const workflowMetrics = {
  jobs: 6,
  activeJobs: 4,
  invites: 28,
  screeningRuns: 9,
  shortlistedCandidates: 12,
  screeningStarted: true,
  screeningCompleted: true,
  interviewsRunning: 3,
  completedInterviews: 18,
  pendingReports: 4,
  reviewedReports: 14,
  decisionsPending: 4,
}
const dashboardState = {
  jobs_count: 6,
  active_jobs_count: 4,
  veris_screening_count: 9,
  interview_links_count: 28,
  interviews_count: 21,
  pending_reviews_count: 4,
  heroState: "decision",
}
const trialCredits = {
  organizationId: ORG_ID,
  interviewCreditsRemaining: 42,
  screeningCreditsRemaining: 186,
  canSendInterview: true,
  canStartScreening: true,
  upgradeMessage: "Premium workspace active",
  source: "subscription",
  subscriptionId: "99999999-9999-4999-8999-999999999999",
  planId: "enterprise-demo",
  subscriptionStatus: "active",
  subscriptionExpiresAt: null,
}

const pendingInterviews = candidates.slice(2, 5).map((candidate, index) => ({
  inviteId: `aaaaaaaa-aaaa-4aaa-8${String(index + 1).padStart(3, "0")}-aaaaaaaaaaaa`,
  link: "http://localhost:3210/interview/marketing-demo",
  interviewId: candidate.interviewId,
  candidateName: candidate.candidateName,
  jobTitle: candidate.jobTitle,
  accessType: "FLEXIBLE",
  startTime: null,
  endTime: null,
  expiresAt: candidate.expiresAt,
  startedAt: candidate.startedAt,
  endedAt: candidate.endedAt,
  createdAt: DEMO_NOW,
  status: candidate.status,
  questionStatus: "READY",
  emailStatus: "SENT",
  failureReason: null,
  lastError: null,
  recovery: null,
}))

const interviews = candidates.map((candidate, index) => ({
  ...candidate,
  interviewStatus: candidate.status,
  finalStatus: candidate.status,
  questionStatus: "READY",
  emailStatus: "SENT",
  failureReason: null,
  lastError: null,
  questionsGeneratedAt: DEMO_NOW,
  emailSentAt: DEMO_NOW,
  inviteStatus: "SENT",
  inviteToken: "marketing-demo",
  link: "http://localhost:3210/interview/marketing-demo",
  attemptStatus: candidate.status === "COMPLETED" ? "completed" : "active",
  earlyExit: false,
  earlyExitRecorded: false,
  terminationType: "completed",
  terminationReason: null,
  interruptionReason: null,
  disconnectReason: null,
  terminationDetectedAt: null,
  completionPercentage: candidate.status === "COMPLETED" ? 100 : index === 3 ? 58 : 0,
  requiredQuestionCount: 8,
  askedQuestionCount: candidate.status === "COMPLETED" ? 8 : index === 3 ? 5 : 0,
  answeredQuestionCount: candidate.status === "COMPLETED" ? 8 : index === 3 ? 4 : 0,
  score: candidate.score,
  recordingId: recordings[index]?.recordingId ?? null,
  recordingUrl: "",
  recordingStatus: candidate.status === "COMPLETED" ? "ready" : "pending",
  hasRecording: candidate.status === "COMPLETED",
  aiSummary: candidate.aiSummaryFull,
  detailsLoaded: true,
}))

const reports = {
  generatedAt: DEMO_NOW,
  executiveSummary: {
    totalCandidates: 38,
    completedInterviews: 18,
    flaggedCandidates: 2,
    recommendedHires: 7,
    dropOffRate: 8.3,
    cards: [
      { label: "Candidates", value: "38", helper: "Across 4 active roles" },
      { label: "Completed", value: "18", helper: "14 evidence reviews complete" },
      { label: "Recommended", value: "7", helper: "Human approval required" },
      { label: "Review queue", value: "4", helper: "Prioritized by evidence" },
    ],
  },
  interviewFunnel: {
    stages: [
      { key: "invited", label: "Invited", count: 28, conversionRate: 100, dropOffRate: 0 },
      { key: "started", label: "Started", count: 24, conversionRate: 85.7, dropOffRate: 14.3 },
      { key: "completed", label: "Completed", count: 18, conversionRate: 75, dropOffRate: 25 },
      { key: "selected", label: "Recommended", count: 7, conversionRate: 38.9, dropOffRate: 61.1 },
    ],
  },
  cognitiveRisk: {
    confidenceScore: 0.88,
    clarityIndex: 0.91,
    suspicionIndex: 0.14,
    behavioralAnomalies: 2,
    narrative: "Most interviews show consistent, explainable behavior. Two integrity signals are queued for contextual human review.",
  },
  interviewTimeline: [
    { id: "event-1", at: "2026-08-01T09:15:00.000Z", title: "Interview started", detail: "Secure device check completed", severity: "info", recordingUrl: "" },
    { id: "event-2", at: "2026-08-01T09:28:00.000Z", title: "Scenario evidence", detail: "Candidate compared cost, risk and recovery trade-offs", severity: "info", recordingUrl: "" },
    { id: "event-3", at: "2026-08-01T09:41:00.000Z", title: "Integrity signal", detail: "Brief attention shift; contextual review recommended", severity: "warning", recordingUrl: "" },
  ],
  fraudDetection: {
    cards: [
      { label: "Evidence coverage", value: "94%", helper: "Across completed interviews" },
      { label: "Review recommended", value: "2", helper: "Human assessment pending" },
      { label: "Clear sessions", value: "16", helper: "No material integrity concerns" },
    ],
    suspiciousPatterns: ["Brief attention shift in one response", "Audio overlap requires contextual review"],
  },
  candidateRanking: candidates.slice(0, 4).map((candidate, index) => ({
    rank: index + 1,
    candidateName: candidate.candidateName,
    jobTitle: candidate.jobTitle,
    score: candidate.score,
    recommendation: index === 1 ? "REVIEW REQUIRED" : "HIRE",
    riskLevel: index === 1 ? "MEDIUM" : "LOW",
    attemptId: candidate.attemptId,
  })),
  roleInsights: jobs.map((job, index) => ({
    jobId: job.jobId,
    jobTitle: job.jobTitle,
    averageScore: index === 0 ? 86 : 81,
    completedInterviews: index === 0 ? 11 : 7,
    flaggedInterviews: 1,
    selectedCandidates: index === 0 ? 4 : 3,
    failureTrend: "Stable",
    skillGaps: index === 0 ? ["Cross-site escalation"] : ["Workforce planning"],
  })),
  auditLogs: [
    { id: "audit-1", at: DEMO_NOW, actor: "Aarav Mehta", action: "Reviewed evidence", target: "Ishita Rao", source: "War Room", detail: "Recommendation retained; final decision pending" },
  ],
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } })
}

export function getMarketingDemoResponse(request: Request) {
  if (process.env.HIREVERI_MARKETING_DEMO !== "true") return null
  const url = new URL(request.url)
  const path = url.pathname

  if (path === "/api/me") return json({ success: true, data: profile })
  if (path === "/api/trial-credits") return json({ success: true, data: trialCredits })
  if (path === "/api/dashboard/overview") return json({ success: true, data: { profile, pipeline, workflowMetrics, dashboardState, pendingInterviews, pendingInterviewsTotal: pendingInterviews.length, candidates, recordedInterviews: recordings, veris, alerts: [], trialCredits } })
  if (path === "/api/dashboard/workflow") return json({ success: true, data: { pipeline, workflowMetrics, dashboardState } })
  if (path === "/api/dashboard/candidates") return json({ success: true, data: candidates })
  if (path === "/api/dashboard/interviews") return json({ success: true, data: interviews })
  if (path === "/api/dashboard/recordings") return json({ success: true, data: recordings })
  if (path === "/api/dashboard/veris") return json({ success: true, data: veris })
  if (path === "/api/dashboard/alerts") return json({ success: true, data: [] })
  if (path === "/api/jobs") return json({ success: true, jobs, meta: { supportsJobActiveState: true, supportsCodingConfig: true, supportsQuestionTypeDefault: true } })
  if (path === "/api/experience-levels") return json([{ id: 2, name: "Associate" }, { id: 3, name: "Mid-level" }, { id: 4, name: "Senior" }, { id: 5, name: "Lead" }])
  if (path === "/api/reports/overview") return json({ success: true, data: reports })
  if (path === "/api/screening/runs") return json({ success: true, data: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", jobId: JOB_ID, batchId: "demo-batch", createdAt: DEMO_NOW, totalCandidates: 8, strongFitCount: 3, avgScore: 84 }] })
  if (path === "/api/process-jd" && request.method === "GET") return json({ success: true, jobs: [{ id: JOB_ID, title: jobs[0].jobTitle, description: jobs[0].jobDescription, requiredSkills: jobs[0].coreSkills, experienceNeeded: 6, roleTitle: jobs[0].jobTitle, sourceJobPositionId: JOB_ID, createdAt: DEMO_NOW }] })

  return null
}
