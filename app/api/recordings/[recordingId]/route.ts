import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse } from "@/lib/server/response"

type RecordingColumnRow = {
  column_name: string
}

type RecordingLookupRow = {
  recording_id: string
  audio_url: string | null
  video_url: string | null
  file_path: string | null
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`
}

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "") || null
}

function getStorageBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "recordings"
}

async function getRecordingColumns() {
  const rows = await prisma.$queryRaw<RecordingColumnRow[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'interview_recordings'
  `

  return new Set(rows.map((row) => row.column_name))
}

function normalizeStorageLocation(value: string) {
  const fallbackBucket = getStorageBucket()
  const supabaseUrl = getSupabaseUrl()
  const trimmed = value.trim()

  if (!trimmed) {
    throw new ApiError(404, "RECORDING_URL_MISSING", "Recording URL is missing")
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const parsedUrl = new URL(trimmed)
    const publicPrefix = "/storage/v1/object/public/"
    const signedPrefix = "/storage/v1/object/sign/"
    const objectPrefix = "/storage/v1/object/"
    const matchingPrefix = [publicPrefix, signedPrefix, objectPrefix].find((prefix) => parsedUrl.pathname.includes(prefix))

    if (!supabaseUrl || parsedUrl.origin !== supabaseUrl || !matchingPrefix) {
      return {
        bucket: null,
        path: null,
        directUrl: trimmed,
      }
    }

    const objectParts = decodeURIComponent(parsedUrl.pathname.slice(parsedUrl.pathname.indexOf(matchingPrefix) + matchingPrefix.length)).split("/").filter(Boolean)
    const bucket = objectParts.shift() || fallbackBucket
    const path = objectParts.join("/")

    return {
      bucket,
      path,
      directUrl: trimmed,
    }
  }

  const withoutLeadingSlash = trimmed.replace(/^\/+/, "")
  return {
    bucket: fallbackBucket,
    path: withoutLeadingSlash,
    directUrl: null,
  }
}

async function requestSignedUrl(bucket: string, path: string) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  const encodedPath = path.split("/").map(encodeURIComponent).join("/")
  const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      expiresIn: 60 * 30,
    }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.signedURL) {
    return {
      ok: false as const,
      status: response.status,
      message: payload?.message || payload?.error || "Unable to create recording playback URL",
    }
  }

  const signedPath = String(payload.signedURL)
  const signedUrl = signedPath.startsWith("http")
    ? signedPath
    : signedPath.startsWith("/storage/v1/")
      ? `${supabaseUrl}${signedPath}`
      : `${supabaseUrl}/storage/v1${signedPath.startsWith("/") ? signedPath : `/${signedPath}`}`

  return {
    ok: true as const,
    signedUrl,
  }
}

async function createSignedUrl(bucket: string, path: string) {
  const fallbackBucket = getStorageBucket()
  const strippedFallbackPath = path.startsWith(`${fallbackBucket}/`) ? path.slice(fallbackBucket.length + 1) : null
  const candidates = [
    { bucket, path },
    ...(strippedFallbackPath ? [{ bucket, path: strippedFallbackPath }] : []),
    ...(bucket !== fallbackBucket ? [{ bucket: fallbackBucket, path }] : []),
    ...(bucket !== fallbackBucket && strippedFallbackPath ? [{ bucket: fallbackBucket, path: strippedFallbackPath }] : []),
  ]
  let lastFailure: { status: number; message: string } | null = null

  for (const candidate of candidates) {
    const result = await requestSignedUrl(candidate.bucket, candidate.path)

    if (!result) {
      return null
    }

    if (result.ok) {
      return result.signedUrl
    }

    lastFailure = {
      status: result.status,
      message: result.message,
    }
  }

  throw new ApiError(
    lastFailure?.status === 400 && /not found/i.test(lastFailure.message) ? 404 : lastFailure?.status ?? 500,
    "RECORDING_FILE_MISSING",
    lastFailure?.message && /not found/i.test(lastFailure.message)
      ? "The recording row exists, but the video file is missing from Supabase Storage."
      : lastFailure?.message || "Unable to create recording playback URL"
  )
}

async function createFirstAvailablePlaybackUrl(locations: Array<ReturnType<typeof normalizeStorageLocation>>) {
  const directUrls: string[] = []
  let lastError: unknown = null

  for (const location of locations) {
    if (location.directUrl && (!location.bucket || !location.path)) {
      directUrls.push(location.directUrl)
    }

    if (!location.bucket || !location.path) {
      continue
    }

    try {
      const signedUrl = await createSignedUrl(location.bucket, location.path)

      if (signedUrl) {
        return signedUrl
      }
    } catch (error) {
      lastError = error
    }
  }

  if (directUrls.length > 0) {
    return directUrls[0]
  }

  if (lastError) {
    throw lastError
  }

  return null
}

/**
 * Turns a playback URL into one the browser will save rather than play.
 *
 * Supabase Storage answers `?download=<name>` with
 * `Content-Disposition: attachment`, which is the only thing that survives the
 * redirect below — an `<a download>` on our own origin is ignored once the
 * response comes from another host.
 */
function asAttachmentUrl(playbackUrl: string, recordingId: string) {
  try {
    const url = new URL(playbackUrl)
    const extension = /\.([a-z0-9]{2,5})$/i.exec(url.pathname)?.[1]?.toLowerCase() ?? "webm"
    url.searchParams.set("download", `verisnova-interview-${recordingId}.${extension}`)
    return url.toString()
  } catch {
    // A malformed or relative location is still worth redirecting to as-is.
    return playbackUrl
  }
}

export async function GET(_request: Request, context: { params: Promise<{ recordingId: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(_request)
    const { recordingId } = await context.params
    const wantsDownload = new URL(_request.url).searchParams.get("download") === "1"
    const columns = await getRecordingColumns()
    const idColumn = columns.has("recording_id") ? "recording_id" : columns.has("id") ? "id" : null
    const audioUrlExpression = columns.has("audio_url")
      ? "ir.audio_url::text"
      : columns.has("recording_url")
        ? "ir.recording_url::text"
        : "null::text"
    const videoUrlExpression = columns.has("video_url") ? "ir.video_url::text" : "null::text"
    const filePathExpression = columns.has("file_path") ? "ir.file_path::text" : "null::text"

    if (!idColumn) {
      throw new ApiError(404, "RECORDINGS_SCHEMA_UNAVAILABLE", "Recording storage columns are not available")
    }

    const joinInterviewExpression = columns.has("interview_id") ? "ir.interview_id" : "ia.interview_id"
    const attemptJoin = columns.has("attempt_id") ? "left join public.interview_attempts ia on ia.attempt_id = ir.attempt_id" : "left join public.interview_attempts ia on false"
    const rows = await prisma.$queryRawUnsafe<RecordingLookupRow[]>(
      `
        select
          ir.${quoteIdentifier(idColumn)}::text as recording_id,
          ${audioUrlExpression} as audio_url,
          ${videoUrlExpression} as video_url,
          ${filePathExpression} as file_path
        from public.interview_recordings ir
        ${attemptJoin}
        left join public.interviews i on i.interview_id = ${joinInterviewExpression}
        where ir.${quoteIdentifier(idColumn)}::text = $1
          and i.organization_id = $2::uuid
        limit 1
      `,
      recordingId,
      auth.organizationId
    )

    const recording = rows[0]

    if (!recording?.audio_url && !recording?.video_url && !recording?.file_path) {
      throw new ApiError(404, "RECORDING_NOT_FOUND", "Recording was not found")
    }

    const locations = Array.from(new Set([
      recording.file_path,
      recording.video_url,
      recording.audio_url,
    ].filter((value): value is string => Boolean(value && value.trim()))))
      .map(normalizeStorageLocation)
    const playbackUrl = await createFirstAvailablePlaybackUrl(locations)

    if (!playbackUrl) {
      throw new ApiError(404, "RECORDING_URL_INVALID", "Recording URL is invalid")
    }

    return NextResponse.redirect(wantsDownload ? asAttachmentUrl(playbackUrl, recordingId) : playbackUrl)
  } catch (error) {
    return errorResponse(error)
  }
}
