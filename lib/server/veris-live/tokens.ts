/**
 * Secrets and opaque identifiers for VERIS Live.
 *
 * Invitation tokens follow the existing recovery-link pattern: 32 random
 * bytes, base64url, only the SHA-256 stored. The raw token exists only in the
 * participant's email. LiveKit identities and room names are random and carry
 * no PII.
 *
 * veris-live verifies tokens with the same hash function (see
 * veris-live/lib/server/participant-access.ts); keep the two in step.
 */

import crypto from "node:crypto"

export const INVITE_TOKEN_PREFIX = "vl_inv_"

export function generateInviteToken() {
  return `${INVITE_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`
}

export function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/** Opaque, unique LiveKit participant identity (matches chk_ip_livekit_identity). */
export function generateLivekitIdentity() {
  return `p_${crypto.randomBytes(18).toString("base64url")}`
}

export function generateRoomName() {
  return `vl_${crypto.randomBytes(16).toString("hex")}`
}

/**
 * An invitation stays valid until 24 hours after the scheduled end, and at
 * least 24 hours from when it is sent (a late-scheduled or re-sent invite
 * should still be usable).
 */
export function inviteExpiry(scheduledStartAt: Date, durationMinutes: number, now = new Date()) {
  const afterScheduledEnd = scheduledStartAt.getTime() + (durationMinutes + 24 * 60) * 60_000
  const fromNow = now.getTime() + 24 * 60 * 60_000
  return new Date(Math.max(afterScheduledEnd, fromNow))
}
