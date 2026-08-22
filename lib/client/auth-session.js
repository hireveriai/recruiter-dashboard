const AUTH_APP_FALLBACK_URL = "https://auth.verisnova.com"
const RECRUITER_ACCESS_PATH = "/recruiter-access"
const AUTH_COOKIE_DOMAINS = ["", ".verisnova.com", ".hireveri.com", ".verihireai.work"]
const AUTH_COOKIE_PREFIXES = ["sb-"]
const AUTH_COOKIE_INFIXES = ["-auth-token"]
const AUTH_COOKIE_NAMES = [
  "hireveri_session",
  "hireveri_war_token",
  "authToken",
  "accessToken",
  "access_token",
  "token",
]

export function getRecruiterLoginUrl() {
  const loginUrl =
    process.env.NEXT_PUBLIC_RECRUITER_LOGIN_URL ||
    process.env.NEXT_PUBLIC_AUTH_APP_URL ||
    process.env.NEXT_PUBLIC_LOGIN_URL ||
    AUTH_APP_FALLBACK_URL

  try {
    const url = new URL(loginUrl)

    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = RECRUITER_ACCESS_PATH
    }

    return url.toString()
  } catch {
    return `${AUTH_APP_FALLBACK_URL}${RECRUITER_ACCESS_PATH}`
  }
}

export function clearVerisnovaSessionCookie() {
  const expires = "Max-Age=0; Path=/"

  function clearCookie(name) {
    AUTH_COOKIE_DOMAINS.forEach((domain) => {
      const domainPart = domain ? `; Domain=${domain}` : ""
      document.cookie = `${name}=; ${expires}${domainPart}`
    })
  }

  AUTH_COOKIE_NAMES.forEach(clearCookie)

  document.cookie
    .split(";")
    .map((entry) => entry.trim().split("=")[0])
    .filter(Boolean)
    .filter((name) => AUTH_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .filter((name) => AUTH_COOKIE_INFIXES.some((infix) => name.includes(infix)))
    .forEach(clearCookie)
}
