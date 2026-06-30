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
}

type DeriveInterviewStatusInput = {
  interviewStatus: string | null
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
  return normalizedStatus === "COMPLETED" || Boolean(attempt.endedAt)
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
  questionStatus,
  emailStatus,
  latestAttempt,
  latestInvite,
}: DeriveInterviewStatusInput) {
  const normalizedInterviewStatus = normalizeStatus(interviewStatus)
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

  if (latestAttempt && isAttemptManualExit(latestAttempt)) {
    return "EARLY_EXIT"
  }

  if (latestAttempt && isAttemptAbandoned(latestAttempt)) {
    return "ABANDONED"
  }

  if (normalizedInterviewStatus === "COMPLETED" || (latestAttempt ? isAttemptCompleted(latestAttempt) : false)) {
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
