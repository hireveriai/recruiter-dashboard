"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"

import {
  DEFAULT_ORG_TIMEZONE,
  DEFAULT_ORG_TIMEZONE_LABEL,
} from "@/lib/time/constants"

const OrgTimezoneContext = createContext({
  timezone: DEFAULT_ORG_TIMEZONE,
  timezoneLabel: DEFAULT_ORG_TIMEZONE_LABEL,
  setTimezoneState: () => {},
})

export function OrgTimezoneProvider({ children, initialTimezone, initialTimezoneLabel }) {
  const [state, setState] = useState({
    timezone: initialTimezone || DEFAULT_ORG_TIMEZONE,
    timezoneLabel: initialTimezoneLabel || DEFAULT_ORG_TIMEZONE_LABEL,
  })

  useEffect(() => {
    setState({
      timezone: initialTimezone || DEFAULT_ORG_TIMEZONE,
      timezoneLabel: initialTimezoneLabel || DEFAULT_ORG_TIMEZONE_LABEL,
    })
  }, [initialTimezone, initialTimezoneLabel])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.__HIREVERI_ORG_TIMEZONE__ = state.timezone
    window.__HIREVERI_ORG_TIMEZONE_LABEL__ = state.timezoneLabel
  }, [state.timezone, state.timezoneLabel])

  const value = useMemo(
    () => ({
      timezone: state.timezone,
      timezoneLabel: state.timezoneLabel,
      setTimezoneState(nextState) {
        setState((current) => ({
          timezone: nextState?.timezone || current.timezone,
          timezoneLabel: nextState?.timezoneLabel || current.timezoneLabel,
        }))
      },
    }),
    [state.timezone, state.timezoneLabel]
  )

  return <OrgTimezoneContext.Provider value={value}>{children}</OrgTimezoneContext.Provider>
}

export function useOrgTimezone() {
  return useContext(OrgTimezoneContext)
}
