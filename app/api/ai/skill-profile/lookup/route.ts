import { NextResponse } from "next/server"

import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { prisma } from "@/lib/server/prisma"
import { errorResponse } from "@/lib/server/response"

async function ensureSkillProfileTable() {
  await prisma.$executeRaw`
    create table if not exists public.interview_skill_profiles (
      profile_id uuid primary key default gen_random_uuid(),
      interview_id uuid,
      attempt_id uuid,
      organization_id uuid,
      skill_scores jsonb not null,
      strengths text[] not null,
      weaknesses text[] not null,
      overall_weighted_score numeric,
      created_at timestamptz not null default now()
    )
  `

  await prisma.$executeRaw`
    create index if not exists idx_interview_skill_profiles_attempt
    on public.interview_skill_profiles (attempt_id)
  `

  await prisma.$executeRaw`
    create index if not exists idx_interview_skill_profiles_interview
    on public.interview_skill_profiles (interview_id)
  `
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const attemptId = url.searchParams.get("attemptId") ?? url.searchParams.get("attempt_id")

    if (!attemptId) {
      return NextResponse.json(
        { success: false, message: "attemptId is required" },
        { status: 400 }
      )
    }

    await requireAiRouteAccess(request, attemptId)
    await ensureSkillProfileTable()

    const rows = await prisma.$queryRaw`
      select
        profile_id,
        interview_id,
        attempt_id,
        organization_id,
        skill_scores,
        strengths,
        weaknesses,
        overall_weighted_score,
        created_at
      from public.interview_skill_profiles
      where attempt_id = ${attemptId}::uuid
      order by created_at desc
      limit 1
    `

    const profile = Array.isArray(rows) ? rows[0] : null

    return NextResponse.json({
      success: true,
      data: profile ?? null,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
