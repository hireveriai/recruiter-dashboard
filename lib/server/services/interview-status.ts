type InviteStatusInput = {
  status: string | null
  usedAt?: Date | string | null
  expiresAt?: Date | string | null
}

type AttemptStatusInput = {
  attemptId?: string | null
  status?: string | null
  endedAt?: Date | string | null
  earlyExit?: boolean | null
  terminationType?: string | null
  requiredQuestionCount?: number | null
  answeredQuestionCount?: number | null
  completionPercentage?: number | null
}

type DeriveInterviewStatusInput = {
  interviewStatus: string | null
  finalStatus?: string | null
  questionStatus?: string | null
  emailStatus?: string | null
  latestAttempt?: AttemptStatusInput | null
  latestInvite?: InviteStatusInput | null
}

function normalizeStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toUpperCase()
}

function isInviteExpired(invite: InviteStatusInput | null | undefined) {
  const expiresAt = invite?.expiresAt ? new Date(invite.expiresAt) : null

  return expiresAt ? expiresAt.getTime() <= Date.now() : false
}

export function isInviteUsable(invite: InviteStatusInput) {
  const normalizedStatus = normalizeStatus(invite.status || "ACTIVE")

  return normalizedStatus === "ACTIVE" && !invite.usedAt && !isInviteExpired(invite)
}

export function isAttemptCompleted(attempt: AttemptStatusInput) {
  const normalizedStatus = normalizeStatus(attempt.status)
  const requiredQuestionCount = Number(attempt.requiredQuestionCount ?? 0)
  const answeredQuestionCount = Number(attempt.answeredQuestionCount ?? 0)
  const completionPercentage = Number(attempt.completionPercentage ?? 0)

  return (
    ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(normalizedStatus) ||
    (requiredQuestionCount > 0 && answeredQuestionCount >= requiredQuestionCount) ||
    completionPercentage >= 1 ||
    completionPercentage >= 100
  )
}

export function isAttemptManualExit(attempt: AttemptStatusInput) {
  const normalizedStatus = normalizeStatus(attempt.status)
  const normalizedTerminationType = normalizeStatus(attempt.terminationType)
  return Boolean(attempt.earlyExit) || ["MANUAL_EXIT", "EARLY_EXIT"].includes(normalizedStatus) || normalizedTerminationType === "MANUAL_EXIT"
}

export function isAttemptAbandoned(attempt: AttemptStatusInput) {
  return normalizeStatus(attempt.status) === "ABANDONED"
}

export function deriveInterviewStatus({
  interviewStatus,
  finalStatus,
  questionStatus,
  emailStatus,
  latestAttempt,
  latestInvite,
}: DeriveInterviewStatusInput) {
  const normalizedInterviewStatus = normalizeStatus(interviewStatus)
  const normalizedFinalStatus = normalizeStatus(finalStatus)
  const normalizedQuestionStatus = normalizeStatus(questionStatus)
  const normalizedEmailStatus = normalizeStatus(emailStatus)
  const normalizedInviteStatus = normalizeStatus(latestInvite?.status)
  const hasStartedAttempt = Boolean(latestAttempt?.attemptId)

  if (normalizedInterviewStatus === "FAILED" || normalizedQuestionStatus === "FAILED") {
    return "PREPARATION_FAILED"
  }

  if (normalizedInterviewStatus === "PREPARING" || normalizedQuestionStatus === "GENERATING") {
    return "PREPARING_INTERVIEW"
  }

  // Integrity checks run BEFORE the completion check, not after. These
  // branches used to sit below it and were unreachable for exactly the cases
  // that needed them: the backend wrote COMPLETED into interviewStatus for
  // abandoned and partially-transcribed sessions, so the first branch matched
  // and the truthful attempt-level signals below were never consulted.
  // An attempt that answered everything asked of it is complete even if its
  // status was left stale -- that case must still win, so it gates the
  // integrity branches rather than sitting after them.
  const attemptAnsweredEverything = latestAttempt ? isAttemptCompleted(latestAttempt) : false

  if (normalizedInterviewStatus === "NEEDS_REVIEW") {
    return "NEEDS_REVIEW"
  }

  if (normalizedFinalStatus === "TRANSCRIPT_REVIEW_REQUIRED") {
    return "NEEDS_REVIEW"
  }

  if (
    latestAttempt &&
    !attemptAnsweredEverything &&
    (isAttemptAbandoned(latestAttempt) || isAttemptManualExit(latestAttempt))
  ) {
    return "NEEDS_REVIEW"
  }

  if (
    ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(normalizedInterviewStatus) ||
    attemptAnsweredEverything
  ) {
    return "COMPLETED"
  }

  if (normalizedInterviewStatus === "FLAGGED") {
    return "FLAGGED"
  }

  if (hasStartedAttempt) {
    return "IN_PROGRESS"
  }

  if (normalizedInterviewStatus === "READY" && normalizedEmailStatus === "FAILED") {
    return "EMAIL_FAILED"
  }

  if (normalizedEmailStatus === "SENDING") {
    return "SENDING_EMAIL"
  }

  if (latestInvite && !isInviteUsable(latestInvite) && normalizedInviteStatus) {
    return isInviteExpired(latestInvite) && !latestInvite.usedAt ? "EXPIRED" : normalizedInviteStatus
  }

  if (normalizedInterviewStatus === "READY") {
    return "READY"
  }

  return normalizedInterviewStatus || "PENDING"
}
