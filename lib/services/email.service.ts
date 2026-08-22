import { Resend } from "resend";
import { formatOrgDateTime } from "@/lib/time";

const DEFAULT_EMAIL_FROM = "VerisNova <no-reply@mail.verisnova.com>";
const MAX_EMAIL_ATTEMPTS = 3;
const RETRYABLE_EMAIL_ERROR_PATTERN = /(timeout|timed out|temporar|rate|429|5\d\d|network|fetch|econnreset|etimedout|socket)/i;

const globalForResend = globalThis as unknown as {
  verisnovaResend?: Resend;
};

type SendEmailParams = {
  to: string;
  name: string;
  link: string;
  companyName?: string | null;
  companyLogo?: string | null;
  roleTitle?: string | null;
  duration?: string | number | null;
  expiryDate?: string | Date | null;
  subjectTemplate?: string | null;
  organizationTimezone?: string | null;
  organizationTimezoneLabel?: string | null;
  scheduledStartUtc?: string | Date | null;
  scheduledEndUtc?: string | Date | null;
};

type SendRecruiterAccessEmailParams = {
  to: string;
  name: string;
  organization: string;
  link: string;
};

type SendRecruiterOnboardingEmailParams = SendRecruiterAccessEmailParams & {
  role: string;
  inviterName: string;
  expiresAt: string | Date;
};

type SendRecruiterOrganizationAddedEmailParams = SendRecruiterAccessEmailParams & {
  role: string;
  inviterName: string;
};

type SupportRequestEmailParams = {
  referenceId: string;
  fullName: string;
  workEmail: string;
  organization: string;
  priority: string;
  category: string;
  message: string;
  attachmentName?: string | null;
  attachmentContent?: string | null;
};

type SendCandidateFeedbackEmailParams = {
  to: string;
  cc?: string[];
  candidateName: string;
  jobTitle: string;
  feedbackText: string;
};

type BillingInvoiceEmailParams = {
  to: string;
  recruiterName?: string | null;
  organizationName: string;
  planName: string;
  invoiceNumber: string;
  invoiceDate: string;
  finalAmountLabel: string;
  interviewCredits: number;
  screeningCredits: number;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  invoicePdfFileName: string;
  invoicePdfBase64: string;
  invoiceDownloadUrl?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(value: unknown, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function interpolateTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? "");
}

function isSafeImageUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value);
}

function formatDurationLabel(duration: string | number | null | undefined) {
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return `${duration} minutes`;
  }

  const normalized = normalizeText(duration);
  return normalized || "Configured by hiring team";
}

function formatExpiryLabel(input: {
  expiryDate?: string | Date | null;
  scheduledEndUtc?: string | Date | null;
  organizationTimezone?: string | null;
}) {
  const source = input.expiryDate ?? input.scheduledEndUtc ?? null;

  if (!source) {
    return "Within the allowed access window";
  }

  if (source instanceof Date || !Number.isNaN(new Date(source).getTime())) {
    return formatOrgDateTime(source, input.organizationTimezone ?? undefined);
  }

  return normalizeText(source, "Within the allowed access window");
}

function buildInterviewSubject(input: {
  candidateName: string;
  companyName: string;
  companyLogo: string;
  roleTitle: string;
  duration: string;
  expiryDate: string;
  interviewUrl: string;
  subjectTemplate?: string | null;
}) {
  const template =
    normalizeText(input.subjectTemplate) ||
    normalizeText(process.env.INTERVIEW_EMAIL_SUBJECT_TEMPLATE) ||
    "You've Been Shortlisted for {{roleTitle}} at {{companyName}}";

  const subject = interpolateTemplate(template, {
    candidateName: input.candidateName,
    companyName: input.companyName,
    companyLogo: input.companyLogo,
    roleTitle: input.roleTitle,
    duration: input.duration,
    expiryDate: input.expiryDate,
    interviewUrl: input.interviewUrl,
  }).replace(/\s+/g, " ").trim();

  return subject || `Interview Invitation - ${input.companyName}`;
}

function buildCompanyLogoHtml(companyLogo: string, companyName: string) {
  if (!companyLogo || !isSafeImageUrl(companyLogo)) {
    return "";
  }

  return `
    <div style="padding-bottom:14px;">
      <img src="${escapeHtml(companyLogo)}" width="112" alt="${escapeHtml(companyName)} logo" style="display:block;max-width:112px;max-height:48px;border:0;outline:none;text-decoration:none;object-fit:contain;" />
    </div>
  `;
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  if (!globalForResend.verisnovaResend) {
    globalForResend.verisnovaResend = new Resend(apiKey);
  }

  return globalForResend.verisnovaResend;
}

function getEmailFrom() {
  const configured = process.env.EMAIL_FROM?.trim();

  return configured || DEFAULT_EMAIL_FROM;
}

function getInterviewEmailFrom() {
  const configured = process.env.INTERVIEW_EMAIL_FROM?.trim();

  if (configured) {
    return configured;
  }

  return getEmailFrom();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown email delivery error";
}

function shouldRetryEmail(error: unknown) {
  return RETRYABLE_EMAIL_ERROR_PATTERN.test(getErrorMessage(error));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(payload: Parameters<Resend["emails"]["send"]>[0]) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_EMAIL_ATTEMPTS; attempt += 1) {
    try {
      const response = await getResendClient().emails.send(payload);

      if (response.error) {
        throw new Error(response.error.message || "Resend failed to send email");
      }

      return response.data;
    } catch (error) {
      lastError = error;

      if (attempt === MAX_EMAIL_ATTEMPTS || !shouldRetryEmail(error)) {
        break;
      }

      await sleep(350 * 2 ** (attempt - 1));
    }
  }

  throw new Error(getErrorMessage(lastError));
}

export async function sendInterviewEmail({
  to,
  name,
  link,
  companyName,
  companyLogo,
  roleTitle,
  duration,
  expiryDate,
  subjectTemplate,
  organizationTimezone,
  organizationTimezoneLabel,
  scheduledStartUtc,
  scheduledEndUtc,
}: SendEmailParams) {
  const displayName = normalizeText(name, "Candidate");
  const displayCompany = normalizeText(companyName, "Hiring Team");
  const displayRole = normalizeText(roleTitle, "the open role");
  const displayLogo = normalizeText(companyLogo);
  const durationLabel = formatDurationLabel(duration);
  const expiryLabel = formatExpiryLabel({ expiryDate, scheduledEndUtc, organizationTimezone });
  const safeName = escapeHtml(displayName);
  const safeLink = escapeHtml(link);
  const safeCompany = escapeHtml(displayCompany);
  const safeRole = escapeHtml(displayRole);
  const safeDuration = escapeHtml(durationLabel);
  const safeExpiry = escapeHtml(expiryLabel);
  const subject = buildInterviewSubject({
    candidateName: displayName,
    companyName: displayCompany,
    companyLogo: displayLogo,
    roleTitle: displayRole,
    duration: durationLabel,
    expiryDate: expiryLabel,
    interviewUrl: link,
    subjectTemplate,
  });

  const scheduleHtml =
    scheduledStartUtc && scheduledEndUtc
      ? `
        <tr>
          <td style="padding:12px 0;border-top:1px solid #e5e7eb;">
            <div style="font-size:12px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Interview Window</div>
            <div style="margin-top:4px;font-size:15px;line-height:22px;color:#0f172a;font-weight:700;">${escapeHtml(formatOrgDateTime(scheduledStartUtc, organizationTimezone ?? undefined))}</div>
            <div style="font-size:13px;line-height:20px;color:#64748b;">Ends ${escapeHtml(formatOrgDateTime(scheduledEndUtc, organizationTimezone ?? undefined))}</div>
            <div style="font-size:13px;line-height:20px;color:#64748b;">Timezone: ${escapeHtml(organizationTimezoneLabel ?? organizationTimezone ?? "Organization Time")}</div>
          </td>
        </tr>
      `
      : ""

  return sendWithRetry({
    from: getInterviewEmailFrom(),
    to,
    subject,
    text: [
      `${displayCompany} Hiring Team`,
      "powered by VerisNova",
      "",
      `Hi ${displayName},`,
      "",
      `You've been shortlisted for the next stage of the hiring process for the role of ${displayRole} at ${displayCompany}.`,
      "Your AI-assisted interview session is now available.",
      "",
      "Interview Details:",
      `- Duration: ${durationLabel}`,
      `- Deadline: ${expiryLabel}`,
      "- Environment: Secure monitored interview room",
      scheduledStartUtc && scheduledEndUtc
        ? `Interview window: ${formatOrgDateTime(scheduledStartUtc, organizationTimezone ?? undefined)} - ${formatOrgDateTime(scheduledEndUtc, organizationTimezone ?? undefined)}`
        : "",
      "",
      "Start secure interview:",
      link,
      "",
      "Please complete the interview in a quiet environment with a stable internet connection.",
      "This session may include integrity and behavioral verification monitoring.",
      "",
      "This interview is conducted through VerisNova's secure structured interview platform.",
    ].filter(Boolean).join("\n"),
    html: `
      <div style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eef2f7;">
          <tr>
            <td align="center" style="padding:28px 14px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;border-collapse:separate;">
                <tr>
                  <td style="padding:0;">
                    <div style="border:1px solid #dbe3ee;border-radius:22px;background:#ffffff;box-shadow:0 18px 48px rgba(15,23,42,0.10);overflow:hidden;">
                      <div style="padding:28px 30px 22px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
                        ${buildCompanyLogoHtml(displayLogo, displayCompany)}
                        <div style="font-size:20px;line-height:28px;font-weight:800;color:#0f172a;">${safeCompany} Hiring Team</div>
                        <div style="margin-top:3px;font-size:12px;line-height:18px;color:#64748b;">powered by VerisNova</div>
                      </div>

                      <div style="padding:30px;">
                        <p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#334155;">Hi ${safeName},</p>
                        <h1 style="margin:0 0 14px;font-size:24px;line-height:32px;color:#0f172a;font-weight:800;">You've been shortlisted</h1>
                        <p style="margin:0 0 22px;font-size:16px;line-height:26px;color:#334155;">
                          You've been shortlisted for the next stage of the hiring process for the role of <strong style="color:#0f172a;">${safeRole}</strong> at <strong style="color:#0f172a;">${safeCompany}</strong>.
                        </p>
                        <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#475569;">
                          Your AI-assisted interview session is now available. Please review the details below and begin when you are ready.
                        </p>

                        <div style="border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc;padding:4px 18px;margin:0 0 26px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="padding:14px 0;">
                                <div style="font-size:12px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Role</div>
                                <div style="margin-top:4px;font-size:15px;line-height:22px;color:#0f172a;font-weight:700;">${safeRole}</div>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:12px 0;border-top:1px solid #e5e7eb;">
                                <div style="font-size:12px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Duration</div>
                                <div style="margin-top:4px;font-size:15px;line-height:22px;color:#0f172a;font-weight:700;">${safeDuration}</div>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:12px 0;border-top:1px solid #e5e7eb;">
                                <div style="font-size:12px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Deadline</div>
                                <div style="margin-top:4px;font-size:15px;line-height:22px;color:#0f172a;font-weight:700;">${safeExpiry}</div>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:12px 0;border-top:1px solid #e5e7eb;">
                                <div style="font-size:12px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Environment</div>
                                <div style="margin-top:4px;font-size:15px;line-height:22px;color:#0f172a;font-weight:700;">Secure monitored interview room</div>
                              </td>
                            </tr>
                            ${scheduleHtml}
                          </table>
                        </div>

                        <div style="text-align:center;margin:0 0 22px;">
                          <a href="${safeLink}"
                             style="display:block;width:100%;box-sizing:border-box;padding:15px 20px;background:#0b1220;color:#ffffff;text-decoration:none;border-radius:14px;font-size:15px;line-height:20px;font-weight:800;text-align:center;">
                            Start Secure Interview
                          </a>
                        </div>

                        <p style="margin:0 0 22px;font-size:12px;line-height:19px;color:#64748b;word-break:break-all;">
                          If the button does not work, paste this URL into your browser:<br />
                          <a href="${safeLink}" style="color:#1d4ed8;text-decoration:underline;">${safeLink}</a>
                        </p>

                        <div style="border-radius:16px;background:#f1f5f9;padding:16px 18px;margin:0 0 22px;">
                          <p style="margin:0 0 8px;font-size:13px;line-height:21px;color:#475569;">Please complete the interview in a quiet environment with a stable internet connection.</p>
                          <p style="margin:0;font-size:13px;line-height:21px;color:#475569;">This session may include integrity and behavioral verification monitoring.</p>
                        </div>

                        <p style="margin:0;font-size:13px;line-height:21px;color:#64748b;">
                          This interview is conducted through VerisNova's secure structured interview platform.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `,
  });
}

export async function sendRecruiterAccessEmail({
  to,
  name,
  organization,
  link,
}: SendRecruiterAccessEmailParams) {
  const safeName = escapeHtml(name || "Recruiter");
  const safeOrganization = escapeHtml(organization || "your organization");
  const safeLink = escapeHtml(link);

  return sendWithRetry({
    from: getEmailFrom(),
    to,
    subject: `Your VerisNova recruiter access for ${organization}`,
    text: [
      `Hi ${name || "Recruiter"},`,
      `You have been added to the ${organization || "your organization"} team on VerisNova Recruiter.`,
      "Open workspace:",
      link,
    ].join("\n"),
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #0f172a;">
        <h2 style="margin-bottom: 12px;">Your recruiter workspace access is ready</h2>

        <p>Hi ${safeName},</p>

        <p>
          You have been added to the <strong>${safeOrganization}</strong> team on VerisNova Recruiter.
          Use the secure workspace link below to sign in and continue.
        </p>

        <a href="${safeLink}"
           style="display:inline-block;padding:12px 18px;background:#0f172a;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;">
           Open Recruiter Workspace
        </a>

        <p style="margin-top:20px;">
          If you already have access, this email simply confirms your current team assignment.
        </p>

        <p style="margin-top:24px;">Regards,<br />VerisNova Recruiter Workspace</p>
      </div>
    `,
  });
}

function recruiterShellHtml(content: string) {
  return `
    <div style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;padding:32px 18px;">
        <div style="border:1px solid #dbe3ee;border-radius:24px;overflow:hidden;background:#ffffff;box-shadow:0 18px 48px rgba(15,23,42,0.10);">
          <div style="padding:26px 28px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">
            <div style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#2563eb;">VerisNova Recruiter</div>
            <h1 style="margin:12px 0 0;font-size:24px;line-height:1.25;color:#0f172a;">Organization access</h1>
          </div>
          <div style="padding:28px;">
            ${content}
          </div>
        </div>
      </div>
    </div>
  `;
}

function actionButtonHtml(link: string, label: string) {
  return `
    <a href="${escapeHtml(link)}"
       style="display:inline-block;margin-top:18px;padding:13px 18px;border-radius:12px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;">
      ${escapeHtml(label)}
    </a>
  `;
}

export async function sendRecruiterOnboardingEmail({
  to,
  name,
  organization,
  role,
  inviterName,
  link,
  expiresAt,
}: SendRecruiterOnboardingEmailParams) {
  const safeName = escapeHtml(name || "Recruiter");
  const safeOrganization = escapeHtml(organization || "your organization");
  const safeRole = escapeHtml(role || "Recruiter");
  const safeInviter = escapeHtml(inviterName || "your team admin");
  const expiry = expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;

  return sendWithRetry({
    from: getEmailFrom(),
    to,
    subject: `Set up your VerisNova access for ${organization}`,
    text: [
      `Hi ${name || "Recruiter"},`,
      `${inviterName || "Your team admin"} invited you to ${organization || "your organization"} on VerisNova Recruiter.`,
      `Assigned role: ${role || "Recruiter"}`,
      `This setup link expires at ${expiry}.`,
      "Set up access:",
      link,
    ].join("\n"),
    html: recruiterShellHtml(`
      <p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;">Hi ${safeName},</p>
      <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">
        ${safeInviter} invited you to join <strong style="color:#0f172a;">${safeOrganization}</strong> on VerisNova Recruiter.
      </p>
      <div style="margin:18px 0;padding:14px 16px;border:1px solid #bfdbfe;border-radius:16px;background:#eff6ff;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#64748b;">Assigned Role</div>
        <div style="margin-top:6px;color:#1d4ed8;font-size:16px;font-weight:700;">${safeRole}</div>
      </div>
      <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">Use the secure setup link below. It expires at ${escapeHtml(expiry)}.</p>
      ${actionButtonHtml(link, "Set Up Recruiter Access")}
      <p style="margin-top:18px;word-break:break-all;color:#64748b;font-size:12px;">${escapeHtml(link)}</p>
    `),
  });
}

export async function sendRecruiterOrganizationAddedEmail({
  to,
  name,
  organization,
  role,
  inviterName,
  link,
}: SendRecruiterOrganizationAddedEmailParams) {
  const safeName = escapeHtml(name || "Recruiter");
  const safeOrganization = escapeHtml(organization || "your organization");
  const safeRole = escapeHtml(role || "Recruiter");
  const safeInviter = escapeHtml(inviterName || "your team admin");

  return sendWithRetry({
    from: getEmailFrom(),
    to,
    subject: `You were added to ${organization} on VerisNova`,
    text: [
      `Hi ${name || "Recruiter"},`,
      `You were added to organization ${organization || "your organization"} by ${inviterName || "your team admin"}.`,
      `Assigned role: ${role || "Recruiter"}`,
      "Open workspace:",
      link,
    ].join("\n"),
    html: recruiterShellHtml(`
      <p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;">Hi ${safeName},</p>
      <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">
        ${safeInviter} added you to organization <strong style="color:#0f172a;">${safeOrganization}</strong>.
      </p>
      <div style="margin:18px 0;padding:14px 16px;border:1px solid #a7f3d0;border-radius:16px;background:#ecfdf5;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#64748b;">Assigned Role</div>
        <div style="margin-top:6px;color:#047857;font-size:16px;font-weight:700;">${safeRole}</div>
      </div>
      ${actionButtonHtml(link, "Open Recruiter Workspace")}
    `),
  });
}

function supportRequestDetailsHtml(input: SupportRequestEmailParams) {
  const rows = [
    ["Reference ID", input.referenceId],
    ["Requester", input.fullName],
    ["Work Email", input.workEmail],
    ["Organization", input.organization],
    ["Priority", input.priority],
    ["Category", input.category],
    ["Attachment", input.attachmentName || "None"],
  ];

  return `
    <div style="margin:18px 0;border:1px solid rgba(51,65,85,0.16);border-radius:14px;overflow:hidden;">
      ${rows
        .map(
          ([label, value]) => `
            <div style="display:flex;gap:16px;padding:11px 14px;border-bottom:1px solid rgba(51,65,85,0.12);">
              <div style="min-width:130px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(label)}</div>
              <div style="color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(value)}</div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

export async function sendSupportNotificationEmail(input: SupportRequestEmailParams) {
  const supportTo = process.env.SUPPORT_EMAIL_TO?.trim() || "support@verisnova.com";

  return sendWithRetry({
    from: getEmailFrom(),
    to: supportTo,
    replyTo: input.workEmail,
    subject: `[${input.priority}] VerisNova support request ${input.referenceId}`,
    attachments: input.attachmentName && input.attachmentContent
      ? [
          {
            filename: input.attachmentName,
            content: input.attachmentContent,
          },
        ]
      : undefined,
    text: [
      `Reference ID: ${input.referenceId}`,
      `Requester: ${input.fullName} <${input.workEmail}>`,
      `Organization: ${input.organization}`,
      `Priority: ${input.priority}`,
      `Category: ${input.category}`,
      `Attachment: ${input.attachmentName || "None"}`,
      "",
      input.message,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#0f172a;">
        <h2 style="margin:0 0 8px;">New VerisNova support request</h2>
        <p style="margin:0;color:#475569;">A requester submitted a support center ticket.</p>
        ${supportRequestDetailsHtml(input)}
        <div style="margin-top:18px;padding:16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <div style="margin-bottom:8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Message</div>
          <div style="white-space:pre-wrap;color:#0f172a;">${escapeHtml(input.message)}</div>
        </div>
      </div>
    `,
  });
}

export async function sendSupportConfirmationEmail(input: SupportRequestEmailParams) {
  return sendWithRetry({
    from: getEmailFrom(),
    to: input.workEmail,
    subject: `VerisNova support request received: ${input.referenceId}`,
    text: [
      `Hi ${input.fullName},`,
      "",
      `We received your VerisNova support request ${input.referenceId}.`,
      `Category: ${input.category}`,
      `Priority: ${input.priority}`,
      "",
      "Our operations team will review it against the applicable support routing and SLA.",
      "",
      "Regards,",
      "VerisNova Support",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#0f172a;">
        <h2 style="margin:0 0 8px;">Support request received</h2>
        <p>Hi ${escapeHtml(input.fullName)},</p>
        <p>We received your VerisNova support request. Keep this reference ID for follow-up:</p>
        <div style="display:inline-block;margin:8px 0 18px;padding:12px 16px;border-radius:12px;background:#0f172a;color:#ffffff;font-weight:700;letter-spacing:0.08em;">
          ${escapeHtml(input.referenceId)}
        </div>
        ${supportRequestDetailsHtml(input)}
        <p style="color:#475569;">Our operations team will review it against the applicable support routing and SLA.</p>
        <p style="margin-top:24px;">Regards,<br />VerisNova Support</p>
      </div>
    `,
  });
}

export async function sendBillingInvoiceEmail(input: BillingInvoiceEmailParams) {
  const safeRecruiterName = escapeHtml(normalizeText(input.recruiterName, "Recruiter"));
  const safeOrganizationName = escapeHtml(input.organizationName);
  const safePlanName = escapeHtml(input.planName);
  const supportEmail = process.env.BILLING_SUPPORT_EMAIL?.trim() || process.env.SUPPORT_EMAIL_TO?.trim() || "support@verisnova.com";
  const rows = [
    ["Organization", input.organizationName],
    ["Plan", input.planName],
    ["Invoice", input.invoiceNumber],
    ["Invoice Date", input.invoiceDate],
    ["Amount Paid", input.finalAmountLabel],
    ["Interview Credits", String(input.interviewCredits)],
    ["Screening Credits", String(input.screeningCredits)],
    ["Razorpay Order", input.razorpayOrderId || "Not available"],
    ["Razorpay Payment", input.razorpayPaymentId || "Not available"],
  ];

  return sendWithRetry({
    from: getEmailFrom(),
    to: input.to,
    subject: `VerisNova Invoice & Subscription Activation - ${input.invoiceNumber}`,
    attachments: [
      {
        filename: input.invoicePdfFileName,
        content: input.invoicePdfBase64,
      },
    ],
    text: [
      `Hi ${input.recruiterName || "Recruiter"},`,
      "",
      `Your VerisNova subscription is active for ${input.organizationName}.`,
      `Plan: ${input.planName}`,
      `Invoice: ${input.invoiceNumber}`,
      `Amount paid: ${input.finalAmountLabel}`,
      `Interview credits: ${input.interviewCredits}`,
      `Screening credits: ${input.screeningCredits}`,
      `Razorpay order: ${input.razorpayOrderId || "Not available"}`,
      `Razorpay payment: ${input.razorpayPaymentId || "Not available"}`,
      input.invoiceDownloadUrl ? `Download invoice: ${input.invoiceDownloadUrl}` : "",
      "",
      `For billing support, contact ${supportEmail}.`,
    ].filter(Boolean).join("\n"),
    html: `
      <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;padding:28px 18px;">
          <div style="border:1px solid #e2e8f0;border-radius:18px;background:#ffffff;overflow:hidden;">
            <div style="padding:24px 26px;border-bottom:1px solid #e2e8f0;background:#0f172a;">
              <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#93c5fd;font-weight:700;">VerisNova Billing</div>
              <h1 style="margin:10px 0 0;color:#ffffff;font-size:24px;line-height:1.25;">Invoice & subscription activation</h1>
            </div>
            <div style="padding:26px;">
              <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">Hi ${safeRecruiterName},</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#334155;">
                Your VerisNova subscription for <strong>${safeOrganizationName}</strong> is active. The GST invoice for <strong>${safePlanName}</strong> is attached for finance and procurement records.
              </p>
              <div style="border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
                ${rows
                  .map(
                    ([label, value]) => `
                      <div style="display:flex;gap:18px;padding:12px 14px;border-bottom:1px solid #e2e8f0;">
                        <div style="min-width:140px;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">${escapeHtml(label)}</div>
                        <div style="font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(value)}</div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
              ${
                input.invoiceDownloadUrl
                  ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(input.invoiceDownloadUrl)}" style="display:inline-block;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 16px;font-size:14px;font-weight:700;">Download invoice</a></p>`
                  : ""
              }
              <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#64748b;">
                For billing, GST, or procurement questions, contact ${escapeHtml(supportEmail)}.
              </p>
            </div>
          </div>
        </div>
      </div>
    `,
  });
}

const CANDIDATE_FEEDBACK_SECTION_HEADINGS = ["strengths", "areas for improvement"];

function isSectionHeadingLine(line: string) {
  return CANDIDATE_FEEDBACK_SECTION_HEADINGS.includes(
    line.trim().replace(/:$/, "").toLowerCase()
  );
}

function isBulletLine(line: string) {
  return /^[-•*]\s+/.test(line.trim());
}

// The AI prompt asks for a strict "Strengths" / "Areas for Improvement"
// two-section bullet format, but a recruiter may hand-edit the draft into
// something looser before sending -- so this renders known section headings
// and bullet runs specially, and falls back to plain paragraphs for
// anything that doesn't match rather than breaking the email.
function renderStructuredFeedbackHtml(feedbackText: string) {
  const lines = feedbackText.split("\n");
  const blocks: string[] = [];
  let bulletBuffer: string[] = [];

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    const items = bulletBuffer
      .map(
        (item) =>
          `<li style="margin:0 0 6px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(item)}</li>`
      )
      .join("");
    blocks.push(`<ul style="margin:0 0 18px;padding-left:20px;">${items}</ul>`);
    bulletBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isSectionHeadingLine(line)) {
      flushBullets();
      blocks.push(
        `<div style="margin:22px 0 10px;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#0f766e;">${escapeHtml(line.replace(/:$/, ""))}</div>`
      );
      continue;
    }

    if (isBulletLine(line)) {
      bulletBuffer.push(line.replace(/^[-•*]\s+/, ""));
      continue;
    }

    flushBullets();
    blocks.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">${escapeHtml(line)}</p>`);
  }
  flushBullets();

  return blocks.join("");
}

export async function sendCandidateFeedbackEmail({
  to,
  cc,
  candidateName,
  jobTitle,
  feedbackText,
}: SendCandidateFeedbackEmailParams) {
  const safeName = escapeHtml(normalizeText(candidateName, "Candidate"));
  const safeRole = escapeHtml(normalizeText(jobTitle, "the role you applied for"));
  const feedbackHtml = renderStructuredFeedbackHtml(feedbackText);

  return sendWithRetry({
    from: getEmailFrom(),
    to,
    ...(cc && cc.length > 0 ? { cc } : {}),
    subject: `Feedback on your interview for ${normalizeText(jobTitle, "the role")}`,
    text: [
      `Hi ${normalizeText(candidateName, "there")},`,
      "",
      `Thank you for taking the time to interview for the ${normalizeText(jobTitle, "role")} position. Here is some feedback on your interview:`,
      "",
      feedbackText,
    ].join("\n"),
    html: `
      <div style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;padding:32px 18px;">
          <div style="border:1px solid #dbe3ee;border-radius:22px;overflow:hidden;background:#ffffff;box-shadow:0 18px 48px rgba(15,23,42,0.10);">
            <div style="padding:26px 28px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">
              <div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#2563eb;">Interview Feedback</div>
              <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;color:#0f172a;">${safeRole}</h1>
            </div>
            <div style="padding:28px;">
              <p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#334155;">Hi ${safeName},</p>
              <p style="margin:0 0 22px;font-size:15px;line-height:24px;color:#475569;">
                Thank you for taking the time to interview for the ${safeRole} position. Here is some feedback on your interview:
              </p>
              ${feedbackHtml}
            </div>
          </div>
        </div>
      </div>
    `,
  });
}

// ---------------------------------------------------------------------------
// Free entitlement (trial / practice) notifications
//
// Reuses the same Resend transport, sender and retry policy as every other
// recruiter email above.
// ---------------------------------------------------------------------------

type TrialAudience = "RECRUITER" | "CANDIDATE";

type TrialRequestEmailParams = {
  kind: TrialAudience;
  status: string;
  to: string;
  name?: string | null;
  companyName?: string | null;
  requestId?: string | null;
};

type TrialDecisionEmailParams = {
  kind: TrialAudience;
  decision: "APPROVE" | "REJECT";
  to: string;
  name?: string | null;
  companyName?: string | null;
  requestId?: string | null;
};

function trialShellHtml(heading: string, content: string) {
  return `
    <div style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;padding:32px 18px;">
        <div style="border:1px solid #dbe3ee;border-radius:24px;overflow:hidden;background:#ffffff;box-shadow:0 18px 48px rgba(15,23,42,0.10);">
          <div style="padding:26px 28px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">
            <div style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#2563eb;">VerisNova</div>
            <h1 style="margin:12px 0 0;font-size:24px;line-height:1.25;color:#0f172a;">${escapeHtml(heading)}</h1>
          </div>
          <div style="padding:28px;">
            ${content}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Sent immediately after a free-entitlement request is submitted. When the
 * automated company validation already approved it, this doubles as the
 * activation email.
 */
export async function sendTrialRequestEmails(params: TrialRequestEmailParams) {
  if (params.status === "APPROVED") {
    return sendTrialDecisionEmail({
      kind: params.kind,
      decision: "APPROVE",
      to: params.to,
      name: params.name,
      companyName: params.companyName,
      requestId: params.requestId,
    });
  }

  const isRecruiter = params.kind === "RECRUITER";
  const safeName = escapeHtml(params.name || (isRecruiter ? "there" : "there"));
  const heading = isRecruiter ? "Free trial request received" : "Free practice request received";
  const offer = isRecruiter
    ? "10 AI Interviews + 25 VERIS Screenings"
    : "1 free VERIS AI practice interview";

  return sendWithRetry({
    from: getEmailFrom(),
    to: params.to,
    subject: heading,
    text: [
      `Hi ${params.name || "there"},`,
      `We received your request for ${offer}.`,
      isRecruiter
        ? "We're verifying your company details. Requests are usually reviewed within 24 hours."
        : "We're running a quick eligibility check. Requests are usually reviewed within 24 hours.",
      params.requestId ? `Reference: ${params.requestId}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    html: trialShellHtml(
      heading,
      `
      <p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;">Hi ${safeName},</p>
      <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">
        We received your request for <strong style="color:#0f172a;">${escapeHtml(offer)}</strong>.
      </p>
      <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">
        ${
          isRecruiter
            ? "We&rsquo;re verifying your company details now. Requests are usually reviewed within 24 hours, and we&rsquo;ll email you as soon as your trial is active."
            : "We&rsquo;re running a quick eligibility check. Requests are usually reviewed within 24 hours, and we&rsquo;ll email you as soon as your free practice interview is ready."
        }
      </p>
      ${
        params.requestId
          ? `<p style="margin:0;color:#64748b;font-size:12px;">Reference: ${escapeHtml(params.requestId)}</p>`
          : ""
      }
    `
    ),
  });
}

export async function sendTrialDecisionEmail(params: TrialDecisionEmailParams) {
  const isRecruiter = params.kind === "RECRUITER";
  const approved = params.decision === "APPROVE";
  const safeName = escapeHtml(params.name || "there");
  const offer = isRecruiter
    ? "10 AI Interviews + 25 VERIS Screenings"
    : "1 free VERIS AI practice interview";

  const heading = approved
    ? isRecruiter
      ? "Your free recruiter trial is active"
      : "Your free practice interview is ready"
    : isRecruiter
      ? "About your free trial request"
      : "About your free practice request";

  const body = approved
    ? `Your ${isRecruiter ? "workspace" : "account"} now has ${offer}. You can start right away from your dashboard.`
    : "We weren't able to approve this request automatically. If you think this is a mistake, reply to this email and a person will take a look.";

  return sendWithRetry({
    from: getEmailFrom(),
    to: params.to,
    subject: heading,
    text: [`Hi ${params.name || "there"},`, body, params.requestId ? `Reference: ${params.requestId}` : ""]
      .filter(Boolean)
      .join("\n"),
    html: trialShellHtml(
      heading,
      `
      <p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;">Hi ${safeName},</p>
      <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(body)}</p>
      ${
        params.companyName
          ? `<p style="margin:0 0 18px;color:#64748b;font-size:13px;">Workspace: ${escapeHtml(params.companyName)}</p>`
          : ""
      }
      ${
        params.requestId
          ? `<p style="margin:0;color:#64748b;font-size:12px;">Reference: ${escapeHtml(params.requestId)}</p>`
          : ""
      }
    `
    ),
  });
}
