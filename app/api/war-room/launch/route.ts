import { NextResponse } from "next/server"

import { getAuthTokenFromRequest, getHireveriSessionFromRequest } from "@/lib/server/auth-context"
import { errorResponse } from "@/lib/server/response"

const WAR_APP_URL = (process.env.NEXT_PUBLIC_WAR_APP_URL || "https://war-room.hireveri.com").replace(/\/+$/, "")
const WAR_ROOM_PATH = "/recruiter/war-room"
const SHARED_COOKIE_DOMAIN = ".hireveri.com"
const SHARED_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 2

function setSharedCookie(response: NextResponse, name: string, value: string) {
  response.cookies.set({
    name,
    value,
    domain: SHARED_COOKIE_DOMAIN,
    path: "/",
    maxAge: SHARED_COOKIE_MAX_AGE_SECONDS,
    sameSite: "none",
    secure: true,
  })
}

export async function GET(request: Request) {
  try {
    const token = getAuthTokenFromRequest(request)
    const hireveriSession = getHireveriSessionFromRequest(request)
    const requestUrl = new URL(request.url)
    const orgId = requestUrl.searchParams.get("orgId")?.trim() || ""
    const theme = requestUrl.searchParams.get("theme")?.trim() || ""

    if ((!token && !hireveriSession) || !orgId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "AUTH_HANDOFF_MISSING",
            message: "Authenticated session handoff could not be prepared",
          },
        },
        { status: 401 }
      )
    }

    const redirectUrl = new URL(`${WAR_APP_URL}${WAR_ROOM_PATH}`)
    redirectUrl.searchParams.set("orgId", orgId)

    if (theme === "light" || theme === "dark") {
      redirectUrl.searchParams.set("theme", theme)
    }

    const response = NextResponse.redirect(redirectUrl)

    if (hireveriSession) {
      setSharedCookie(response, "hireveri_session", hireveriSession)
    }

    if (token) {
      setSharedCookie(response, "authToken", token)
      setSharedCookie(response, "accessToken", token)
    }

    return response
  } catch (error) {
    return errorResponse(error)
  }
}
