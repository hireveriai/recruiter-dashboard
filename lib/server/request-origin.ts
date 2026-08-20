import { createHash } from "crypto"

export const DEVICE_COOKIE_NAME = "hv_device"

export type RequestOrigin = {
  ip: string | null
  userAgent: string | null
  deviceHash: string | null
  /** Set when the caller should persist a freshly minted device cookie. */
  issuedDeviceId: string | null
}

function firstForwardedIp(value: string | null) {
  if (!value) return null
  const candidate = value.split(",")[0]?.trim()
  return candidate || null
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie")
  if (!header) return null

  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) {
      return decodeURIComponent(rest.join("=")) || null
    }
  }

  return null
}

/**
 * Collects the abuse-prevention signals we can read from an ordinary request.
 *
 * The "device" signal is a first-party opaque cookie value hashed together
 * with the user agent — not a fingerprint. It is deliberately weak: it exists
 * so that a burst of free-entitlement requests from one browser lands in
 * manual review, not so that anybody is permanently identified or blocked.
 */
export function getRequestOrigin(request: Request): RequestOrigin {
  const headers = request.headers
  const ip =
    firstForwardedIp(headers.get("x-forwarded-for")) ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    null
  const userAgent = headers.get("user-agent")

  let deviceId = readCookie(request, DEVICE_COOKIE_NAME)
  let issuedDeviceId: string | null = null

  if (!deviceId) {
    deviceId = crypto.randomUUID()
    issuedDeviceId = deviceId
  }

  const deviceHash = createHash("sha256")
    .update(`${deviceId}|${userAgent ?? ""}`)
    .digest("hex")
    .slice(0, 48)

  return { ip, userAgent, deviceHash, issuedDeviceId }
}

export function applyDeviceCookie(response: Response, origin: RequestOrigin) {
  if (!origin.issuedDeviceId) return response

  response.headers.append(
    "Set-Cookie",
    `${DEVICE_COOKIE_NAME}=${origin.issuedDeviceId}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax; HttpOnly${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`
  )

  return response
}
