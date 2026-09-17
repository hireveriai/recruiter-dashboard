export const FEATURE_PERMISSIONS = {
  dashboard: [],
  aiScreening: ["ai.use"],
  jobs: ["interviews.create", "interviews.edit"],
  candidates: ["candidates.view"],
  interviews: ["interviews.create", "interviews.edit", "interviews.delete"],
  reports: ["reports.view"],
  billing: ["billing.view"],
  alerts: ["alerts.view"],
  manageTeam: ["users.manage"],
  settings: ["organization.settings"],
  createJob: ["interviews.create"],
  sendInterview: ["candidates.invite", "interviews.create"],
  editInterview: ["interviews.edit"],
  deleteInterview: ["interviews.delete"],
  retryInterview: ["interviews.edit"],
  warRoom: ["warroom.view", "warroom.analyze"],
  warRoomAnalyze: ["warroom.analyze"],
  copilot: ["ai.use"],
  assessments: ["assessments.view"],
  createAssessment: ["assessments.create"],
  editAssessment: ["assessments.edit"],
  publishAssessment: ["assessments.publish"],
  sendAssessment: ["assessments.send"],
  viewAssessmentResults: ["assessments.view_results"],
  manageAssessments: ["assessments.manage"],
  employees: ["employees.view"],
  createEmployee: ["employees.create"],
  editEmployee: ["employees.edit"],
  employeeActivities: ["employeeActivities.view"],
  createEmployeeActivity: ["employeeActivities.create"],
  editEmployeeActivity: ["employeeActivities.edit"],
  assignEmployeeActivity: ["employeeActivities.assign"],
  viewEmployeeActivityResults: ["employeeActivities.view_results"],
  reviewEmployeeActivity: ["employeeActivities.review"],
  manageEmployeeActivities: ["employeeActivities.manage"],
};

/**
 * Which organization-level product entitlement (see lib/server/entitlements.ts
 * for the server-side source of truth — Navbar/dashboard/pages/APIs all read
 * the same computed map) each feature requires, if any. A feature with no
 * entry here is Core: account/org-level functionality (dashboard, candidates,
 * reports, billing, team management, alerts, settings) that isn't a single
 * paid product module and stays visible regardless of what the org bought.
 */
export const FEATURE_ENTITLEMENTS = {
  aiScreening: "SCREENING",
  copilot: "SCREENING",
  assessments: "ASSESSMENT",
  createAssessment: "ASSESSMENT",
  editAssessment: "ASSESSMENT",
  publishAssessment: "ASSESSMENT",
  sendAssessment: "ASSESSMENT",
  viewAssessmentResults: "ASSESSMENT",
  manageAssessments: "ASSESSMENT",
  jobs: "AI_INTERVIEW",
  interviews: "AI_INTERVIEW",
  createJob: "AI_INTERVIEW",
  sendInterview: "AI_INTERVIEW",
  editInterview: "AI_INTERVIEW",
  deleteInterview: "AI_INTERVIEW",
  retryInterview: "AI_INTERVIEW",
  warRoom: "AI_INTERVIEW",
  warRoomAnalyze: "AI_INTERVIEW",
  employees: "EMPLOYEE_ACTIVITIES",
  createEmployee: "EMPLOYEE_ACTIVITIES",
  editEmployee: "EMPLOYEE_ACTIVITIES",
  employeeActivities: "EMPLOYEE_ACTIVITIES",
  createEmployeeActivity: "EMPLOYEE_ACTIVITIES",
  editEmployeeActivity: "EMPLOYEE_ACTIVITIES",
  assignEmployeeActivity: "EMPLOYEE_ACTIVITIES",
  viewEmployeeActivityResults: "EMPLOYEE_ACTIVITIES",
  reviewEmployeeActivity: "EMPLOYEE_ACTIVITIES",
  manageEmployeeActivities: "EMPLOYEE_ACTIVITIES",
};

/**
 * Optimistic default used only until the real entitlement map has loaded
 * (mirrors DEFAULT_RECRUITER_PERMISSION_PROFILE below) — never used once the
 * server has actually told us what the org owns.
 */
export const DEFAULT_ENTITLEMENTS = {
  AI_INTERVIEW: true,
  SCREENING: true,
  ASSESSMENT: true,
  EMPLOYEE_ACTIVITIES: true,
};

export const DEFAULT_RECRUITER_PERMISSIONS = [
  "ai.use",
  "alerts.view",
  "candidates.invite",
  "candidates.view",
  "interviews.create",
  "interviews.edit",
  "reports.view",
  "assessments.view",
  "assessments.create",
  "assessments.edit",
  "assessments.publish",
  "assessments.send",
  "assessments.view_results",
  "employees.view",
  "employees.create",
  "employees.edit",
  "employeeActivities.view",
  "employeeActivities.create",
  "employeeActivities.edit",
  "employeeActivities.assign",
  "employeeActivities.view_results",
];

export const DEFAULT_RECRUITER_PERMISSION_PROFILE = {
  permissions: DEFAULT_RECRUITER_PERMISSIONS,
  isOptimisticPermissions: true,
};

function toPermissionSet(source) {
  if (Array.isArray(source)) {
    return new Set(source.filter(Boolean));
  }

  if (Array.isArray(source?.permissions)) {
    return new Set(source.permissions.filter(Boolean));
  }

  return new Set();
}

export function hasAnyPermission(source, required = []) {
  if (!required.length) {
    return true;
  }

  const permissions = toPermissionSet(source);
  return required.some((permission) => permissions.has(permission));
}

export function hasAllPermissions(source, required = []) {
  if (!required.length) {
    return true;
  }

  const permissions = toPermissionSet(source);
  return required.every((permission) => permissions.has(permission));
}

/**
 * Combines both authorization layers: does the org's plan include this
 * feature's module (entitlements, undefined while still loading falls back
 * to an optimistic "allow"), AND does this recruiter have the permission for
 * it. Both must pass — an org can own Assessment while a specific recruiter
 * still lacks assessments.view, and a recruiter can hold assessments.view
 * while their org has never purchased Assessment.
 */
export function canAccessFeature(source, feature, entitlements) {
  if (!hasAnyPermission(source, FEATURE_PERMISSIONS[feature] ?? [])) {
    return false;
  }

  const requiredEntitlement = FEATURE_ENTITLEMENTS[feature];
  if (!requiredEntitlement) {
    return true;
  }

  const effectiveEntitlements = entitlements ?? DEFAULT_ENTITLEMENTS;
  return Boolean(effectiveEntitlements[requiredEntitlement]);
}
