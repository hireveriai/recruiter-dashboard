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

export function canAccessFeature(source, feature) {
  return hasAnyPermission(source, FEATURE_PERMISSIONS[feature] ?? []);
}
