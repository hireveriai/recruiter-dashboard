/**
 * Keeps VERIS Live Interviews out of AI Interview queries.
 *
 * Live interviews are ordinary public.interviews rows with
 * delivery_mode = 'LIVE'. AI screens that read public.interviews directly
 * (rather than through interview_attempts / interview_invites, which Live
 * never has) must add this predicate so AI dashboards, counts and alerts stay
 * exactly as they were.
 *
 * Written against the row's JSON form so it is correct both before and after
 * migration 023: with no delivery_mode column every row is an AI interview.
 */

import { Prisma } from "@prisma/client"

const ALIAS_PATTERN = /^[a-z_][a-z0-9_]*$/

export function aiInterviewsOnly(alias: string) {
  if (!ALIAS_PATTERN.test(alias)) {
    throw new Error(`Invalid SQL alias: ${alias}`)
  }
  return Prisma.sql`coalesce(to_jsonb(${Prisma.raw(alias)}) ->> 'delivery_mode', 'AI') = 'AI'`
}
