"use client"

const PREFIX = "verisnova:json-cache:"
const DEFAULT_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const DEFAULT_FRESH_AGE_MS = 30 * 1000

function getCacheKey(key) {
  return `${PREFIX}${key}`
}

export function readSessionJsonCache(key, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(getCacheKey(key))
    const cached = raw ? JSON.parse(raw) : null

    if (!cached || Date.now() - Number(cached.cachedAt) > maxAgeMs) {
      return null
    }

    return cached.value ?? null
  } catch {
    return null
  }
}

export function hasSessionJsonCache(key, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  return readSessionJsonCache(key, maxAgeMs) !== null
}

export function getSessionJsonCacheAge(key) {
  if (typeof window === "undefined") {
    return Number.POSITIVE_INFINITY
  }

  try {
    const raw = window.sessionStorage.getItem(getCacheKey(key))
    const cached = raw ? JSON.parse(raw) : null
    const cachedAt = Number(cached?.cachedAt)
    return Number.isFinite(cachedAt) ? Math.max(0, Date.now() - cachedAt) : Number.POSITIVE_INFINITY
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function isSessionJsonCacheFresh(key, maxAgeMs = DEFAULT_FRESH_AGE_MS) {
  return getSessionJsonCacheAge(key) <= maxAgeMs
}

export function writeSessionJsonCache(key, value) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.sessionStorage.setItem(
      getCacheKey(key),
      JSON.stringify({
        cachedAt: Date.now(),
        value,
      })
    )
  } catch {
    // Session storage is a performance aid only.
  }
}

export function removeSessionJsonCache(key) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.sessionStorage.removeItem(getCacheKey(key))
  } catch {
    // Session storage is a performance aid only.
  }
}
