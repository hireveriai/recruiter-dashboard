import { NextResponse } from "next/server"

const AUTH_COOKIE_NAMES = [
  "hireveri_session",
  "hireveri_war_token",
  "authToken",
  "accessToken",
  "access_token",
  "token",
]
const COOKIE_DOMAINS = [undefined, ".verisnova.com", ".hireveri.com", ".verihireai.work"]

function isAuthCookieName(name: string) {
  return (
    AUTH_COOKIE_NAMES.includes(name) ||
    (name.startsWith("sb-") && name.includes("-auth-token"))
  )
}

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname
  return hostname === "localhost" || hostname === "127.0.0.1"
}

function clearCookie(response: NextResponse, name: string, request: Request) {
  for (const domain of COOKIE_DOMAINS) {
    const options = {
      httpOnly: true,
      sameSite: "lax",
      secure: !isLocalRequest(request),
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    } as const

    response.cookies.set(
      name,
      "",
      domain
        ? {
            ...options,
            domain,
          }
        : options
    )
  }
}

export async function POST(request: Request) {
  const response = NextResponse.json(
    {
      success: true,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    }
  )

  const cookieHeader = request.headers.get("cookie") ?? ""
  const requestCookieNames = cookieHeader
    .split(";")
    .map((entry) => entry.trim().split("=")[0])
    .filter(Boolean)
    .filter(isAuthCookieName)

  for (const name of new Set([...AUTH_COOKIE_NAMES, ...requestCookieNames])) {
    clearCookie(response, name, request)
  }

  return response
}
