import { NextResponse } from "next/server"
import { z } from "zod"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { prisma } from "@/lib/server/prisma"
import { errorResponse } from "@/lib/server/response"
import {
  DEFAULT_ORG_TIMEZONE,
  DEFAULT_ORG_TIMEZONE_LABEL,
  ORG_TIMEZONE_OPTIONS,
} from "@/lib/time/constants"

const payloadSchema = z.object({
  timezone: z.string().trim().min(1).optional(),
  timezoneLabel: z.string().trim().min(1).optional(),
  notifyRecruitingTeam: z.boolean().optional(),
})

function resolveTimezoneLabel(timezone: string, timezoneLabel?: string) {
  if (timezoneLabel) {
    return timezoneLabel
  }

  return (
    ORG_TIMEZONE_OPTIONS.find((option) => option.value === timezone)?.label ??
    DEFAULT_ORG_TIMEZONE_LABEL
  )
}

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const rows = await prisma.$queryRaw<Array<{
      timezone: string | null
      timezone_label: string | null
      notify_recruiting_team: boolean | null
    }>>`
      select timezone, timezone_label, notify_recruiting_team
      from public.organizations
      where organization_id = ${auth.organizationId}::uuid
      limit 1
    `

    const organization = rows[0]

    const response = NextResponse.json({
      success: true,
      data: {
        timezone: organization?.timezone ?? DEFAULT_ORG_TIMEZONE,
        timezoneLabel: organization?.timezone_label ?? DEFAULT_ORG_TIMEZONE_LABEL,
        notifyRecruitingTeam: organization?.notify_recruiting_team ?? true,
      },
    })
    response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120")
    return response
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const parsed = payloadSchema.parse(await request.json())

    const data: { timezone?: string; timezoneLabel?: string; notifyRecruitingTeam?: boolean } = {}

    if (parsed.timezone !== undefined) {
      data.timezone = parsed.timezone
      data.timezoneLabel = resolveTimezoneLabel(parsed.timezone, parsed.timezoneLabel)
    }

    if (parsed.notifyRecruitingTeam !== undefined) {
      data.notifyRecruitingTeam = parsed.notifyRecruitingTeam
    }

    if (data.timezone !== undefined) {
      await prisma.$executeRaw`
        update public.organizations
        set
          timezone = ${data.timezone},
          timezone_label = ${data.timezoneLabel}
        where organization_id = ${auth.organizationId}::uuid
      `
    }

    if (data.notifyRecruitingTeam !== undefined) {
      await prisma.$executeRaw`
        update public.organizations
        set notify_recruiting_team = ${data.notifyRecruitingTeam}
        where organization_id = ${auth.organizationId}::uuid
      `
    }

    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
