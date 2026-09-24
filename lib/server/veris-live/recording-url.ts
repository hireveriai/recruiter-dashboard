import { ApiError } from "@/lib/server/errors"

/**
 * Short-lived (10 min) signed playback URL for a private VERIS Live
 * recording in Supabase Storage. Same bucket and credentials as the existing
 * recording playback route; the object path comes from the DB, never the request.
 */
export async function signLiveRecordingUrl(path: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "")
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const bucket = process.env.RECORDING_S3_BUCKET?.trim() || process.env.SUPABASE_STORAGE_BUCKET?.trim() || "recordings"
  if (!supabaseUrl || !serviceRoleKey) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Recording storage is not configured.")

  const encodedPath = path.split("/").map(encodeURIComponent).join("/")
  const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({ expiresIn: 600 }),
  })
  const payload = (await response.json().catch(() => null)) as { signedURL?: string } | null
  if (!response.ok || !payload?.signedURL) throw new ApiError(404, "RECORDING_FILE_MISSING", "The recording file is not available.")

  const signed = payload.signedURL
  return signed.startsWith("http") ? signed : `${supabaseUrl}/storage/v1${signed.startsWith("/") ? signed : `/${signed}`}`
}
