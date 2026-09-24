/**
 * Server-side LiveKit room control for VERIS Live (never exposed to browsers).
 *
 * Used when the recruiter revokes a participant or cancels a session: the
 * affected people are removed from the room immediately instead of waiting
 * for veris-live's periodic authorization check. Their existing LiveKit
 * token cannot be reused to rejoin because every new media token is issued
 * only after a fresh database check, which now fails.
 *
 * Best-effort and idempotent: a participant who already left, a room that
 * no longer exists, or missing LiveKit configuration never fails the
 * recruiter's operation.
 */

import { RoomServiceClient } from "livekit-server-sdk"

export type RoomControl = {
  removeParticipant(roomName: string, identity: string): Promise<void>
  deleteRoom(roomName: string): Promise<void>
}

export type RoomControlOutcome = "done" | "not_present" | "not_configured" | "failed"

function isNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const status = (error as { status?: number })?.status
  return status === 404 || /not.?found|does not exist|no such/i.test(message)
}

export function livekitRoomControl(): RoomControl | null {
  const url = process.env.LIVEKIT_URL?.trim()
  const apiKey = process.env.LIVEKIT_API_KEY?.trim()
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim()
  if (!url || !apiKey || !apiSecret) return null
  const client = new RoomServiceClient(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), apiKey, apiSecret)
  return {
    removeParticipant: async (roomName, identity) => {
      await client.removeParticipant(roomName, identity)
    },
    deleteRoom: async (roomName) => {
      await client.deleteRoom(roomName)
    },
  }
}

function log(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ scope: "veris_live", event, ...fields }))
}

async function attempt(action: () => Promise<void>, event: string, fields: Record<string, unknown>): Promise<RoomControlOutcome> {
  try {
    await action()
    log(event, { ...fields, outcome: "done" })
    return "done"
  } catch (error) {
    const outcome: RoomControlOutcome = isNotFound(error) ? "not_present" : "failed"
    log(event, { ...fields, outcome })
    return outcome
  }
}

export async function removeFromRoom(
  control: RoomControl | null,
  target: { roomName: string; identity: string; interviewId: string; participantId: string }
): Promise<RoomControlOutcome> {
  if (!control) {
    log("livekit_remove_skipped", { interviewId: target.interviewId, participantId: target.participantId, reason: "not_configured" })
    return "not_configured"
  }
  return attempt(() => control.removeParticipant(target.roomName, target.identity), "livekit_participant_removed", {
    interviewId: target.interviewId,
    participantId: target.participantId,
  })
}

export async function closeRoom(control: RoomControl | null, target: { roomName: string; interviewId: string }): Promise<RoomControlOutcome> {
  if (!control) {
    log("livekit_close_skipped", { interviewId: target.interviewId, reason: "not_configured" })
    return "not_configured"
  }
  return attempt(() => control.deleteRoom(target.roomName), "livekit_room_closed", { interviewId: target.interviewId })
}
