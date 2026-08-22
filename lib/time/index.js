import { formatDistanceToNowStrict } from "date-fns"
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz"

import {
  DEFAULT_ORG_TIMEZONE,
  DEFAULT_ORG_TIMEZONE_LABEL,
  getTimezoneOption,
} from "@/lib/time/constants"

export function getOrgTimezone(orgTimezone) {
  if (!orgTimezone && typeof window !== "undefined" && window.__HIREVERI_ORG_TIMEZONE__) {
    return window.__HIREVERI_ORG_TIMEZONE__
  }

  return orgTimezone || DEFAULT_ORG_TIMEZONE
}

export function getOrgTimezoneLabel(orgTimezone, timezoneLabel) {
  if (!timezoneLabel && typeof window !== "undefined" && window.__HIREVERI_ORG_TIMEZONE_LABEL__) {
    return window.__HIREVERI_ORG_TIMEZONE_LABEL__
  }

  if (timezoneLabel) {
    return timezoneLabel
  }

  return getTimezoneOption(getOrgTimezone(orgTimezone)).label || DEFAULT_ORG_TIMEZONE_LABEL
}

export function isValidDateValue(value) {
  if (!value) {
    return false
  }

  const date = value instanceof Date ? value : new Date(value)
  return !Number.isNaN(date.getTime())
}

function normalizeDate(value) {
  if (!isValidDateValue(value)) {
    return null
  }

  return value instanceof Date ? value : new Date(value)
}

export function getTimezoneShortLabel(value, orgTimezone) {
  const date = normalizeDate(value)
  if (!date) {
    return ""
  }

  const timezone = getOrgTimezone(orgTimezone)
  const option = getTimezoneOption(timezone)
  const configuredBadge = [option.flag, option.badge].filter(Boolean).join(" ")

  if (configuredBadge) {
    return configuredBadge
  }

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(date)

    const zone = parts.find((part) => part.type === "timeZoneName")?.value ?? ""
    return /^GMT[+-]/i.test(zone) ? option.badge || "ORG" : zone
  } catch {
    return option.badge || "ORG"
  }
}

export function convertUtcToOrgTime(value, orgTimezone) {
  const date = normalizeDate(value)
  if (!date) {
    return null
  }

  return toZonedTime(date, getOrgTimezone(orgTimezone))
}

export function convertOrgTimeToUtc(value, orgTimezone) {
  if (!value) {
    return null
  }

  try {
    return fromZonedTime(value, getOrgTimezone(orgTimezone)).toISOString()
  } catch {
    return null
  }
}

export function formatOrgDateTime(value, orgTimezone, options = {}) {
  const date = normalizeDate(value)
  if (!date) {
    return "-"
  }

  const timezone = getOrgTimezone(orgTimezone)
  const pattern = options.includeSeconds
    ? "dd MMM yyyy • hh:mm:ss a"
    : "dd MMM yyyy • hh:mm a"
  const formatted = formatInTimeZone(date, timezone, pattern)
  const zone = getTimezoneShortLabel(date, timezone)

  return options.withTimezone === false || !zone ? formatted : `${formatted} ${zone}`
}

export function formatOrgDate(value, orgTimezone) {
  const date = normalizeDate(value)
  if (!date) {
    return "-"
  }

  return formatInTimeZone(date, getOrgTimezone(orgTimezone), "dd MMM yyyy")
}

export function formatOrgTime(value, orgTimezone, options = {}) {
  const date = normalizeDate(value)
  if (!date) {
    return "-"
  }

  const timezone = getOrgTimezone(orgTimezone)
  const formatted = formatInTimeZone(
    date,
    timezone,
    options.includeSeconds ? "hh:mm:ss a" : "hh:mm a"
  )
  const zone = getTimezoneShortLabel(date, timezone)

  return options.withTimezone === false || !zone ? formatted : `${formatted} ${zone}`
}

export function formatRelativeTime(value) {
  const date = normalizeDate(value)
  if (!date) {
    return "-"
  }

  return formatDistanceToNowStrict(date, { addSuffix: true })
}

export function toOrgDateTimeInputValue(value, orgTimezone) {
  const zoned = convertUtcToOrgTime(value, orgTimezone)
  if (!zoned) {
    return ""
  }

  return formatInTimeZone(zoned, getOrgTimezone(orgTimezone), "yyyy-MM-dd'T'HH:mm")
}
