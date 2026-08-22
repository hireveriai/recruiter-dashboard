"use client"

import { useEffect, useMemo, useState } from "react"

function resolveAuthSearch() {
  if (typeof window === "undefined") {
    return ""
  }

  const url = new URL(window.location.href)
  const userId = url.searchParams.get("userId")
  const organizationId = url.searchParams.get("organizationId")

  if (userId && organizationId) {
    return url.search
  }

  let fallback = null

  try {
    const storedAuth = window.sessionStorage.getItem("verisnova-auth")
    if (storedAuth) {
      const parsed = JSON.parse(storedAuth)
      if (parsed?.userId && parsed?.organizationId) {
        fallback = {
          userId: parsed.userId,
          organizationId: parsed.organizationId,
        }
      }
    }
  } catch (error) {
    console.warn("Failed to parse cached auth params", error)
  }

  if (!fallback) {
    try {
      const cachedOverview = window.sessionStorage.getItem("verisnova-overview")
      if (cachedOverview) {
        const parsedOverview = JSON.parse(cachedOverview)
        const profile = parsedOverview?.profile
        if (profile?.userId && profile?.organizationId) {
          fallback = {
            userId: profile.userId,
            organizationId: profile.organizationId,
          }
        }
      }
    } catch (error) {
      console.warn("Failed to parse cached recruiter overview", error)
    }
  }

  if (!fallback) {
    return ""
  }

  const params = new URLSearchParams(url.search)
  params.set("userId", fallback.userId)
  params.set("organizationId", fallback.organizationId)
  return `?${params.toString()}`
}

export function useAuthSearchParams() {
  const [search, setSearch] = useState(resolveAuthSearch)

  useEffect(() => {
    const url = new URL(window.location.href)
    const userId = url.searchParams.get("userId")
    const organizationId = url.searchParams.get("organizationId")
    let targetSearch = url.search

    if (userId && organizationId) {
      try {
        window.sessionStorage.setItem(
          "verisnova-auth",
          JSON.stringify({
            userId,
            organizationId,
          })
        )
      } catch (error) {
        console.warn("Failed to cache recruiter auth params", error)
      }
    } else {
      let fallback = null

      try {
        const storedAuth = window.sessionStorage.getItem("verisnova-auth")
        if (storedAuth) {
          const parsed = JSON.parse(storedAuth)
          if (parsed?.userId && parsed?.organizationId) {
            fallback = {
              userId: parsed.userId,
              organizationId: parsed.organizationId,
            }
          }
        }
      } catch (error) {
        console.warn("Failed to parse cached auth params", error)
      }

      if (!fallback) {
        try {
          const cachedOverview = window.sessionStorage.getItem("verisnova-overview")
          if (cachedOverview) {
            const parsedOverview = JSON.parse(cachedOverview)
            const profile = parsedOverview?.profile
            if (profile?.userId && profile?.organizationId) {
              fallback = {
                userId: profile.userId,
                organizationId: profile.organizationId,
              }
            }
          }
        } catch (error) {
          console.warn("Failed to parse cached recruiter overview", error)
        }
      }

      if (fallback) {
        url.searchParams.set("userId", fallback.userId)
        url.searchParams.set("organizationId", fallback.organizationId)
        targetSearch = `?${url.searchParams.toString()}`
      }
    }

    const shouldCleanUrl = url.searchParams.has("userId") || url.searchParams.has("organizationId")

    if (shouldCleanUrl) {
      url.searchParams.delete("userId")
      url.searchParams.delete("organizationId")
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
    }

    setSearch(targetSearch)
  }, [])

  return useMemo(() => new URLSearchParams(search), [search])
}
