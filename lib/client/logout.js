import { clearVerisnovaSessionCookie, getRecruiterLoginUrl } from "@/lib/client/auth-session"

const LOGOUT_TIMEOUT_MS = 1200
const PRESERVED_LOCAL_STORAGE_PREFIXES = ["verisnova-read-alert-ids"]

function withTimeout(promise, timeoutMs = LOGOUT_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

async function clearBrowserCaches() {
  if (typeof window === "undefined" || !("caches" in window)) {
    return
  }

  try {
    const cacheNames = await window.caches.keys()
    await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)))
  } catch {
    // Cache cleanup should never block logout.
  }
}

function clearBrowserStorage() {
  if (typeof window === "undefined") {
    return
  }

  const preservedLocalStorage = []

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key && PRESERVED_LOCAL_STORAGE_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
        preservedLocalStorage.push([key, window.localStorage.getItem(key)])
      }
    }

    window.localStorage.clear()
    preservedLocalStorage.forEach(([key, value]) => {
      if (value !== null) {
        window.localStorage.setItem(key, value)
      }
    })
  } catch {
    window.localStorage.removeItem("verisnova:last-activity-at")
  }

  try {
    window.sessionStorage.clear()
  } catch {
    window.sessionStorage.removeItem("verisnova-overview")
  }
}

async function clearServerSession() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      keepalive: true,
      headers: {
        "Cache-Control": "no-store",
      },
    })
  } catch {
    // Client-side cookie and storage cleanup still runs even if the network is interrupted.
  }
}

export function clearRecruiterSessionCookie() {
  clearVerisnovaSessionCookie()
}

export async function logoutRecruiter(redirectUrl = getRecruiterLoginUrl()) {
  if (typeof window === "undefined") {
    return
  }

  clearRecruiterSessionCookie()
  clearBrowserStorage()

  await withTimeout(Promise.allSettled([clearServerSession(), clearBrowserCaches()]))

  clearRecruiterSessionCookie()
  clearBrowserStorage()
  window.location.replace(redirectUrl)
}
