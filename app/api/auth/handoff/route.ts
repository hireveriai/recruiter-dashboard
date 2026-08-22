import { NextResponse } from "next/server"

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const AUTH_COOKIE_NAMES = [
  "hireveri_session",
  "authToken",
  "accessToken",
  "access_token",
  "token",
]
const COOKIE_DOMAINS = [undefined, ".verisnova.com", ".hireveri.com", ".verihireai.work"]

function sameOriginPath(value: string | null) {
  if (!value) {
    return "/"
  }

  try {
    const parsed = new URL(value, "https://recruiter.verisnova.com")
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return "/"
  }
}

function cookieOptions(request: Request) {
  const hostname = new URL(request.url).hostname
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1"

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !isLocalhost,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("token")?.trim()
  const session = url.searchParams.get("session")?.trim()
  const next = sameOriginPath(url.searchParams.get("next"))

  if (!token && !session) {
    return NextResponse.redirect(new URL("/", url.origin))
  }

  const response = NextResponse.redirect(new URL(next, url.origin))
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  const options = cookieOptions(request)

  for (const name of AUTH_COOKIE_NAMES) {
    for (const domain of COOKIE_DOMAINS) {
      response.cookies.set(name, "", {
        ...options,
        ...(domain ? { domain } : {}),
        maxAge: 0,
      })
    }
  }

  if (token) {
    response.cookies.set("authToken", token, options)
    response.cookies.set("accessToken", token, options)
    response.cookies.set("access_token", token, options)
    response.cookies.set("token", token, options)
  }

  if (session) {
    response.cookies.set("hireveri_session", session, options)
  }

  return response
}
