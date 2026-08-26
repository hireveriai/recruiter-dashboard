import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"
import {
  sendInterviewCompletedNotificationEmail,
  sendInterviewStartedNotificationEmail,
} from "@/lib/services/email.service"

const MAX_DELIVERY_ATTEMPTS = 3

export type NotificationEventType = "INTERVIEW_STARTED" | "INTERVIEW_COMPLETED"

export type NotificationRecipientCandidate = {
  userId: string
  email: string | null
  isActive: boolean
}

export type ResolvedRecipient = {
  userId: string
  email: string
  kind: "RECRUITER" | "TEAM_MEMBER"
}

/**
 * Pure recipient resolution: recruiter + (team members iff enabled), deduped by
 * user id so a recruiter who is also a team member is only ever counted once.
 * Only active users with a usable (non-empty) email are eligible.
 */
export function resolveNotificationRecipients(input: {
  recruiter: NotificationRecipientCandidate | null
  teamMembers: NotificationRecipientCandidate[]
  notifyRecruitingTeam: boolean
}): ResolvedRecipient[] {
  const isUsable = (candidate: NotificationRecipientCandidate | null | undefined) =>
    Boolean(candidate && candidate.isActive && candidate.email && candidate.email.trim())

  const recipients = new Map<string, ResolvedRecipient>()

  if (isUsable(input.recruiter)) {
    const recruiter = input.recruiter as NotificationRecipientCandidate
    recipients.set(recruiter.userId, {
      userId: recruiter.userId,
      email: recruiter.email!.trim(),
      kind: "RECRUITER",
    })
  }

  if (input.notifyRecruitingTeam) {
    for (const member of input.teamMembers) {
      if (!isUsable(member) || recipients.has(member.userId)) {
        continue
      }

      recipients.set(member.userId, {
        userId: member.userId,
        email: member.email!.trim(),
        kind: "TEAM_MEMBER",
      })
    }
  }

  return Array.from(recipients.values())
}

type PendingEventRow = {
  event_id: string
  organization_id: string
  interview_id: string
  attempt_id: string
  event_type: NotificationEventType
  event_at: Date
}

async function claimPendingNotificationEvents(limit: number) {
  return prisma.$queryRaw<PendingEventRow[]>(Prisma.sql`
    with claimed as (
      select e.event_id
      from public.interview_notification_events e
      where e.status = 'PENDING'
         or (
           e.status = 'FAILED'
           and (
             select count(*) from public.interview_notification_deliveries d
             where d.event_id = e.event_id and d.status = 'FAILED' and d.attempts >= ${MAX_DELIVERY_ATTEMPTS}
           ) = 0
         )
      order by e.created_at asc
      limit ${limit}
      for update skip locked
    )
    update public.interview_notification_events e
    set status = 'PENDING'
    from claimed
    where e.event_id = claimed.event_id
    returning
      e.event_id::text,
      e.organization_id::text,
      e.interview_id::text,
      e.attempt_id::text,
      e.event_type,
      e.event_at
  `)
}

type NotificationContextRow = {
  organization_id: string
  organization_name: string | null
  notify_recruiting_team: boolean
  interview_id: string
  job_title: string | null
  duration_minutes: number | null
  candidate_name: string | null
  created_by: string | null
  attempt_started_at: Date | null
  attempt_ended_at: Date | null
  final_score: number | null
}

async function loadNotificationContext(organizationId: string, interviewId: string, attemptId: string) {
  const rows = await prisma.$queryRaw<NotificationContextRow[]>(Prisma.sql`
    select
      o.organization_id::text,
      o.organization_name,
      o.notify_recruiting_team,
      i.interview_id::text,
      jp.job_title,
      coalesce(i.duration_minutes, jp.interview_duration_minutes) as duration_minutes,
      c.full_name as candidate_name,
      i.created_by::text,
      ia.started_at as attempt_started_at,
      ia.ended_at as attempt_ended_at,
      ie.final_score
    from public.organizations o
    join public.interviews i
      on i.organization_id = o.organization_id
      and i.interview_id = ${interviewId}::uuid
    left join public.job_positions jp
      on jp.job_id = i.job_id and jp.organization_id = o.organization_id
    left join public.candidates c
      on c.candidate_id = i.candidate_id and c.organization_id = o.organization_id
    left join public.interview_attempts ia
      on ia.attempt_id = ${attemptId}::uuid and ia.interview_id = i.interview_id
    left join public.interview_evaluations ie
      on ie.attempt_id = ia.attempt_id
    where o.organization_id = ${organizationId}::uuid
    limit 1
  `)

  return rows[0] ?? null
}

async function loadRecruiter(organizationId: string, userId: string | null) {
  if (!userId) {
    return null
  }

  const rows = await prisma.$queryRaw<Array<{ user_id: string; email: string | null; is_active: boolean }>>(
    Prisma.sql`
      select user_id::text, email, is_active
      from public.users
      where user_id = ${userId}::uuid
        and organization_id = ${organizationId}::uuid
      limit 1
    `
  )

  const row = rows[0]

  if (!row) {
    return null
  }

  return { userId: row.user_id, email: row.email, isActive: row.is_active } satisfies NotificationRecipientCandidate
}

async function loadTeamMembers(organizationId: string) {
  const rows = await prisma.$queryRaw<Array<{ user_id: string; email: string | null; is_active: boolean }>>(
    Prisma.sql`
      select user_id::text, email, is_active
      from public.users
      where organization_id = ${organizationId}::uuid
        and role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
        and is_active = true
    `
  )

  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    isActive: row.is_active,
  })) satisfies NotificationRecipientCandidate[]
}

async function queueDeliveries(event: PendingEventRow, recipients: ResolvedRecipient[]) {
  for (const recipient of recipients) {
    await prisma.$executeRaw(Prisma.sql`
      insert into public.interview_notification_deliveries (
        event_id, organization_id, recipient_user_id, recipient_email, recipient_kind
      )
      values (
        ${event.event_id}::uuid,
        ${event.organization_id}::uuid,
        ${recipient.userId}::uuid,
        ${recipient.email},
        ${recipient.kind}
      )
      on conflict (event_id, recipient_email) do nothing
    `)
  }
}

type PendingDeliveryRow = {
  delivery_id: string
  recipient_email: string
  recipient_kind: "RECRUITER" | "TEAM_MEMBER"
  attempts: number
}

async function loadPendingDeliveries(eventId: string) {
  return prisma.$queryRaw<PendingDeliveryRow[]>(Prisma.sql`
    select delivery_id::text, recipient_email, recipient_kind, attempts
    from public.interview_notification_deliveries
    where event_id = ${eventId}::uuid
      and status = 'PENDING'
  `)
}

async function markDeliverySent(deliveryId: string) {
  await prisma.$executeRaw(Prisma.sql`
    update public.interview_notification_deliveries
    set status = 'SENT', sent_at = now(), attempts = attempts + 1
    where delivery_id = ${deliveryId}::uuid
      and status = 'PENDING'
  `)
}

async function markDeliveryFailed(deliveryId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  await prisma.$executeRaw(Prisma.sql`
    update public.interview_notification_deliveries
    set status = case when attempts + 1 >= ${MAX_DELIVERY_ATTEMPTS} then 'FAILED' else 'PENDING' end,
        attempts = attempts + 1,
        last_error = ${message}
    where delivery_id = ${deliveryId}::uuid
      and status = 'PENDING'
  `)
}

async function eventHasOutstandingDeliveries(eventId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    select count(*) as count
    from public.interview_notification_deliveries
    where event_id = ${eventId}::uuid
      and status = 'PENDING'
  `)

  return Number(rows[0]?.count ?? 0) > 0
}

async function markEventStatus(eventId: string, status: "PROCESSED" | "FAILED" | "PENDING", error?: string) {
  await prisma.$executeRaw(Prisma.sql`
    update public.interview_notification_events
    set status = ${status},
        processed_at = case when ${status} in ('PROCESSED', 'FAILED') then now() else processed_at end,
        error = ${error ?? null}
    where event_id = ${eventId}::uuid
  `)
}

function buildDashboardInterviewUrl(interviewId: string) {
  const base = (
    process.env.RECRUITER_APP_URL ||
    process.env.NEXT_PUBLIC_RECRUITER_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://recruiter.verisnova.com"
  ).replace(/\/$/, "")

  return `${base}/interviews?interviewId=${encodeURIComponent(interviewId)}`
}

async function sendDeliveryEmail(
  event: PendingEventRow,
  delivery: PendingDeliveryRow,
  context: NotificationContextRow
) {
  const shared = {
    to: delivery.recipient_email,
    candidateName: context.candidate_name || "The candidate",
    jobTitle: context.job_title || "the role",
    organizationName: context.organization_name || "your organization",
    durationMinutes: context.duration_minutes ?? null,
    interviewUrl: buildDashboardInterviewUrl(event.interview_id),
  }

  if (event.event_type === "INTERVIEW_STARTED") {
    await sendInterviewStartedNotificationEmail({
      ...shared,
      startedAt: context.attempt_started_at ?? event.event_at,
    })
    return
  }

  await sendInterviewCompletedNotificationEmail({
    ...shared,
    completedAt: context.attempt_ended_at ?? event.event_at,
    // Only surface a score if evaluation has actually persisted for this
    // attempt by send time; never show a score that may still be processing.
    score: context.final_score ?? null,
  })
}

async function processEvent(event: PendingEventRow) {
  try {
    const context = await loadNotificationContext(event.organization_id, event.interview_id, event.attempt_id)

    if (!context) {
      await markEventStatus(event.event_id, "FAILED", "Interview context not found")
      return { eventId: event.event_id, processed: false }
    }

    const [recruiter, teamMembers] = await Promise.all([
      loadRecruiter(context.organization_id, context.created_by),
      loadTeamMembers(context.organization_id),
    ])

    const recipients = resolveNotificationRecipients({
      recruiter,
      teamMembers,
      notifyRecruitingTeam: context.notify_recruiting_team,
    })

    await queueDeliveries(event, recipients)

    const pendingDeliveries = await loadPendingDeliveries(event.event_id)

    for (const delivery of pendingDeliveries) {
      try {
        await sendDeliveryEmail(event, delivery, context)
        await markDeliverySent(delivery.delivery_id)
      } catch (sendError) {
        console.error("interview-notifications: delivery send failed", {
          eventId: event.event_id,
          deliveryId: delivery.delivery_id,
          error: sendError,
        })
        await markDeliveryFailed(delivery.delivery_id, sendError)
      }
    }

    const stillOutstanding = await eventHasOutstandingDeliveries(event.event_id)
    await markEventStatus(event.event_id, stillOutstanding ? "PENDING" : "PROCESSED")

    return { eventId: event.event_id, processed: !stillOutstanding }
  } catch (error) {
    console.error("interview-notifications: event processing failed", {
      eventId: event.event_id,
      error,
    })
    await markEventStatus(
      event.event_id,
      "PENDING",
      error instanceof Error ? error.message : String(error)
    )
    return { eventId: event.event_id, processed: false }
  }
}

export async function processPendingInterviewNotifications(limit = 25) {
  const events = await claimPendingNotificationEvents(limit)
  const results = []

  for (const event of events) {
    results.push(await processEvent(event))
  }

  return {
    claimed: events.length,
    processed: results.filter((result) => result.processed).length,
  }
}
