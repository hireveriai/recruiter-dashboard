import { NextResponse, type NextRequest } from "next/server"
import { getMarketingDemoResponse } from "./lib/server/marketing-demo"

const LOGIN_URL =
  process.env.NEXT_PUBLIC_RECRUITER_LOGIN_URL ||
  process.env.NEXT_PUBLIC_AUTH_APP_URL ||
  process.env.NEXT_PUBLIC_LOGIN_URL ||
  "https://auth.hireveri.com"

const PROTECTED_PAGE_PREFIXES = [
  "/",
  "/ai-screening",
  "/jobs",
  "/candidates",
  "/interviews",
  "/reports",
  "/manage-team",
  "/settings",
  "/contact-us",
  "/billing",
  "/subscription",
]

const PROTECTED_API_PREFIXES = [
  "/api/me",
  "/api/dashboard",
  "/api/upload-resumes",
  "/api/process-jd",
  "/api/match-candidates",
  "/api/send-interviews",
  "/api/ai-screening",
  "/api/jobs",
  "/api/candidate",
  "/api/interview/create-link",
  "/api/interview/manage",
  "/api/manage-team",
  "/api/experience-levels",
  "/api/war-room",
  "/api/validate-coupon",
  "/api/create-order",
  "/api/verify-payment",
  "/api/payment-failed",
  "/api/billing",
  "/api/trial-credits",
]

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"))
}

function hasAuthorizationHeader(request: NextRequest) {
  const authorization = request.headers.get("authorization")
  return Boolean(authorization && authorization.toLowerCase().startsWith("bearer "))
}

function hasAuthenticatedSession(request: NextRequest) {
  return Boolean(
    request.cookies.get("hireveri_session")?.value ||
      request.cookies.get("authToken")?.value ||
      request.cookies.get("accessToken")?.value ||
      request.cookies.get("access_token")?.value ||
      request.cookies.get("token")?.value ||
      hasSupabaseAuthCookie(request) ||
      hasAuthorizationHeader(request)
  )
}

function isProtectedPage(pathname: string) {
  return PROTECTED_PAGE_PREFIXES.some((prefix) => pathname === prefix || (prefix !== "/" && pathname.startsWith(prefix)))
}

function isProtectedApi(pathname: string) {
  return PROTECTED_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function getRecruiterAccessUrl() {
  const loginUrl = new URL(LOGIN_URL)

  if (loginUrl.pathname === "/" || loginUrl.pathname === "") {
    loginUrl.pathname = "/recruiter-access"
  }

  return loginUrl
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const marketingDemoResponse = getMarketingDemoResponse(request)
  if (marketingDemoResponse) {
    return marketingDemoResponse
  }

  if (!isProtectedPage(pathname) && !isProtectedApi(pathname)) {
    return NextResponse.next()
  }

  if (hasAuthenticatedSession(request)) {
    return NextResponse.next()
  }

  if (isProtectedApi(pathname)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication is required",
        },
      },
      { status: 401 }
    )
  }

  const loginUrl = getRecruiterAccessUrl()
  loginUrl.searchParams.set("next", request.nextUrl.href)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
}
