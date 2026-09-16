import { randomBytes, createHash } from "crypto"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { assertCanEmployees } from "@/lib/server/employees/auth"
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
    const { id } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })

    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    const isEmployeeActivity = assessment.participantType === "EMPLOYEE"
    if (isEmployeeActivity) {
      await assertCanEmployees(auth, "employeeActivities.assign")
    } else {
      await assertCanAssessment(auth, "assessments.send")
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

    let candidate: { candidateId: string; email: string; fullName: string } | null = null
    let employee: { id: string; email: string; fullName: string } | null = null

    if (isEmployeeActivity) {
      if (!payload.employeeId) {
        throw new ApiError(400, "EMPLOYEE_REQUIRED", "employeeId is required for an Employee activity")
      }

      // Unlike candidates, an employee is never find-or-created here — they
      // must already be registered via the Employees page, and must belong
      // to this organization (never trust a client-supplied employeeId
      // beyond using it to look the row up scoped to auth.organizationId).
      const employeeRow = await prisma.employee.findFirst({
        where: { id: payload.employeeId, organizationId: auth.organizationId },
      })
      if (!employeeRow) {
        throw new ApiError(404, "EMPLOYEE_NOT_FOUND", "Employee not found for this organization")
      }
      if (employeeRow.status !== "ACTIVE") {
        throw new ApiError(409, "EMPLOYEE_INACTIVE", "This employee is inactive and cannot be assigned an activity")
      }
      employee = employeeRow
    } else {
      candidate = payload.candidateId
        ? await prisma.candidate.findFirst({
            where: { candidateId: payload.candidateId, organizationId: auth.organizationId },
          })
        : null

      if (!candidate && payload.candidateId) {
        throw new ApiError(404, "CANDIDATE_NOT_FOUND", "Candidate not found for this organization")
      }

      // Manual-email path: a recruiter can invite someone who isn't already a
      // candidate in this workspace. Find-or-create scoped to this org, rather
      // than requiring them to exist beforehand.
      if (!candidate && payload.candidateEmail) {
        candidate = await prisma.candidate.findFirst({
          where: {
            organizationId: auth.organizationId,
            email: { equals: payload.candidateEmail, mode: "insensitive" },
          },
        })

        if (!candidate) {
          candidate = await prisma.candidate.create({
            data: {
              organizationId: auth.organizationId,
              email: payload.candidateEmail,
              fullName: payload.candidateName?.trim() || payload.candidateEmail,
            },
          })
        }
      }

      if (!candidate) {
        throw new ApiError(400, "CANDIDATE_REQUIRED", "candidateId or candidateEmail is required")
      }
    }

    const recipient = employee ?? candidate!

    const [job, organization] = await Promise.all([
      assessment.jobId
        ? prisma.jobPosition.findUnique({
            where: { jobId: assessment.jobId },
            select: { jobId: true, jobTitle: true },
          })
        : Promise.resolve(null),
      prisma.organization.findUnique({
        where: { organizationId: auth.organizationId },
        select: { organizationName: true },
      }),
    ])

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
        creditWarning = "This workspace has no VERIS Assessment credits remaining. The invite can still be sent, but completing it may fail to score without available credits."
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
        candidateId: candidate ? candidate.candidateId : null,
        employeeId: employee ? employee.id : null,
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
    // rather than hard-failing invite creation when it isn't set yet. The
    // token-based /a/{token} flow in the assessment app is participant-
    // agnostic (it resolves everything from the invite row), so the same URL
    // shape serves both candidate and employee invites.
    const baseUrl =
      (process.env.ASSESSMENT_APP_BASE_URL || "").trim().replace(/\/+$/, "") ||
      "https://assessment.verisnova.com"
    const assessmentUrl = `${baseUrl}/a/${token}`

    let emailSent = false
    let emailError: string | null = null
    try {
      await sendAssessmentInvitationEmail({
        to: recipient.email,
        candidateName: recipient.fullName,
        jobTitle: job?.jobTitle ?? "the open role",
        assessmentTitle: assessment.title,
        durationMinutes: assessment.durationMinutes,
        expiresAt,
        assessmentUrl,
        companyName: organization?.organizationName ?? null,
        activityType: assessment.activityType as "ASSESSMENT" | "CHALLENGE" | "TASK",
        participantType: assessment.participantType as "CANDIDATE" | "EMPLOYEE",
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
