import { randomBytes, createHash } from "crypto"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { inviteAssessmentSchema } from "@/lib/server/assessment/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"
import { getAssessmentCreditSnapshot } from "@/lib/server/services/assessment-credits"
import { sendAssessmentInvitationEmail } from "@/lib/services/email.service"

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.send")
    const { id } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })

    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    // Unpublished/unreviewed AI questions (including question.rubric and
    // option.isCorrect, which must never reach a candidate) must never be
    // sent, so only a PUBLISHED assessment with an activeVersionId may be
    // invited to.
    if (assessment.status !== "PUBLISHED" || !assessment.activeVersionId) {
      throw new ApiError(
        409,
        "ASSESSMENT_NOT_PUBLISHED",
        "Publish this assessment before sending it to a candidate."
      )
    }

    const payload = inviteAssessmentSchema.parse(await request.json())
    const versionId = payload.versionId ?? assessment.activeVersionId

    if (versionId !== assessment.activeVersionId) {
      const version = await prisma.assessmentVersion.findFirst({
        where: { id: versionId, assessmentId: id, status: "FINALIZED" },
      })
      if (!version) {
        throw new ApiError(400, "INVALID_VERSION", "versionId must be a finalized version of this assessment")
      }
    }

    const candidate = await prisma.candidate.findFirst({
      where: { candidateId: payload.candidateId, organizationId: auth.organizationId },
    })

    if (!candidate) {
      throw new ApiError(404, "CANDIDATE_NOT_FOUND", "Candidate not found for this organization")
    }

    const job = await prisma.jobPosition.findUnique({
      where: { jobId: assessment.jobId },
      select: { jobId: true, jobTitle: true },
    })

    // Soft pre-check only: sending an invite must NEVER deduct a credit
    // (deductAssessmentCredit is only ever called by the separate
    // candidate-facing app, on a completed attempt). A recruiter who is out
    // of credits is still allowed to send the invite - they just see a
    // warning - because blocking sends on this balance would let a stale
    // credit read (or a credit top-up in flight) block a real invite
    // unnecessarily. Document/UX can escalate this to a hard block later if
    // product wants that; this is the deliberate soft-warning choice.
    let creditWarning: string | null = null
    try {
      const snapshot = await getAssessmentCreditSnapshot(auth.organizationId)
      if (!snapshot.canRunAssessment) {
        creditWarning = "This workspace has no VERIS Assessment credits remaining. The candidate can still be invited, but completing the assessment may fail to score without available credits."
      }
    } catch (error) {
      console.warn("Assessment credit pre-check failed", error)
    }

    const token = randomBytes(32).toString("hex")
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + assessment.linkExpiryDays * 24 * 60 * 60 * 1000)

    const invite = await prisma.assessmentInvite.create({
      data: {
        assessmentId: id,
        versionId,
        jobId: assessment.jobId,
        candidateId: candidate.candidateId,
        organizationId: auth.organizationId,
        tokenHash,
        status: "INVITED",
        expiresAt,
        sentAt: new Date(),
        createdBy: auth.userId,
      },
    })

    // Matches the fallback pattern in lib/server/interview-url.ts: prefer the
    // configured env var, but degrade to the intended production domain
    // rather than hard-failing invite creation when it isn't set yet.
    const baseUrl =
      (process.env.ASSESSMENT_APP_BASE_URL || "").trim().replace(/\/+$/, "") ||
      "https://assessment.verisnova.com"
    const assessmentUrl = `${baseUrl}/a/${token}`

    let emailSent = false
    let emailError: string | null = null
    try {
      await sendAssessmentInvitationEmail({
        to: candidate.email,
        candidateName: candidate.fullName,
        jobTitle: job?.jobTitle ?? "the open role",
        assessmentTitle: assessment.title,
        durationMinutes: assessment.durationMinutes,
        expiresAt,
        assessmentUrl,
        companyName: null,
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : "Failed to send invitation email"
      console.error("Assessment invitation email failed", error)
    }

    return successResponse(
      {
        invite,
        assessmentUrl,
        emailSent,
        emailError,
        creditWarning,
      },
      201
    )
  } catch (error) {
    return errorResponse(error)
  }
}
