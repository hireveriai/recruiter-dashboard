import { createHash, randomBytes } from "crypto"

/**
 * Assessment invite tokens: the raw token goes only into the emailed link,
 * the database stores its sha256 (assessment_invites.token_hash), which is
 * what the assessment app looks the invite up by. Shared by the single
 * invite route and bulk employee targeting so both mint identical links.
 */
export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function createInviteToken() {
  const token = randomBytes(32).toString("hex")
  return { token, tokenHash: hashInviteToken(token) }
}

// Matches the fallback pattern in lib/server/interview-url.ts: prefer the
// configured env var, but degrade to the intended production domain rather
// than hard-failing invite creation when it isn't set yet. The token-based
// /a/{token} flow in the assessment app is participant-agnostic (it resolves
// everything from the invite row), so the same URL shape serves both
// candidate and employee invites.
export function buildAssessmentUrl(token: string) {
  const baseUrl =
    (process.env.ASSESSMENT_APP_BASE_URL || "").trim().replace(/\/+$/, "") || "https://assessment.verisnova.com"
  return `${baseUrl}/a/${token}`
}
