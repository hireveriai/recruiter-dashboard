import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import {
  buildAnswerFallbackSummary,
  deriveResultFromAnswerSummaries,
  fetchAnswerSummaries,
  type InterviewAnswerSummary,
} from "@/lib/server/services/interview-summary"

type ReportInterview = {
  interviewId: string
  attemptId: string | null
  candidateName: string
  jobTitle: string
  interviewStatus: string | null
  attemptStatus: string | null
  startedAt: Date | null
  endedAt: Date | null
  finalScore: unknown | null
  decision: string | null
  aiSummary: string | null
  createdAt: Date
}

type ReportPayload = {
  interview: ReportInterview
  score: number | null
  decision: string | null
  summary: string
  answers: InterviewAnswerSummary[]
}

type PdfContext = {
  doc: PDFDocument
  page: PDFPage
  regular: PDFFont
  bold: PDFFont
  y: number
  pageNumber: number
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 48
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const INK = rgb(0.09, 0.12, 0.18)
const MUTED = rgb(0.36, 0.42, 0.52)
const LINE = rgb(0.82, 0.86, 0.91)
const ACCENT = rgb(0.02, 0.45, 0.5)

function normalizeStatus(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase()
}

function isCompleted(row: ReportInterview) {
  return Boolean(
    row.endedAt ||
      ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(normalizeStatus(row.interviewStatus)) ||
      ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(normalizeStatus(row.attemptStatus)),
  )
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date)
}

function formatScore(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${Math.round(value)}%`
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase() || "candidate-report"
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const normalized = String(text || "-").replace(/\s+/g, " ").trim()
  const words = normalized.split(" ")
  const lines: string[] = []
  let current = ""

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
      continue
    }

    if (current) {
      lines.push(current)
    }
    current = word
  }

  if (current) {
    lines.push(current)
  }

  return lines.length > 0 ? lines : ["-"]
}

function addFooter(ctx: PdfContext) {
  ctx.page.drawText(`HireVeri Candidate Report | Page ${ctx.pageNumber}`, {
    x: MARGIN,
    y: 24,
    size: 8,
    font: ctx.regular,
    color: MUTED,
  })
}

function addPage(ctx: PdfContext) {
  addFooter(ctx)
  ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  ctx.pageNumber += 1
  ctx.y = PAGE_HEIGHT - MARGIN
}

function ensureSpace(ctx: PdfContext, height: number) {
  if (ctx.y - height < 56) {
    addPage(ctx)
  }
}

function drawTextBlock(
  ctx: PdfContext,
  text: string,
  options: {
    x?: number
    size?: number
    font?: PDFFont
    color?: ReturnType<typeof rgb>
    maxWidth?: number
    lineHeight?: number
  } = {},
) {
  const x = options.x ?? MARGIN
  const size = options.size ?? 10
  const font = options.font ?? ctx.regular
  const color = options.color ?? INK
  const lineHeight = options.lineHeight ?? size + 5
  const maxWidth = options.maxWidth ?? CONTENT_WIDTH
  const lines = wrapText(text, font, size, maxWidth)
  ensureSpace(ctx, lines.length * lineHeight + 4)

  for (const line of lines) {
    ctx.page.drawText(line, { x, y: ctx.y, size, font, color })
    ctx.y -= lineHeight
  }
}

function drawSectionTitle(ctx: PdfContext, title: string) {
  ensureSpace(ctx, 34)
  ctx.y -= 8
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 16 },
    end: { x: PAGE_WIDTH - MARGIN, y: ctx.y + 16 },
    thickness: 0.75,
    color: LINE,
  })
  ctx.page.drawText(title, {
    x: MARGIN,
    y: ctx.y,
    size: 13,
    font: ctx.bold,
    color: ACCENT,
  })
  ctx.y -= 22
}

const METRIC_VALUE_SIZE = 18
const METRIC_VALUE_LINE_HEIGHT = 21
const METRIC_TOP_PADDING = 24
const METRIC_LABEL_GAP = 14
const METRIC_BOTTOM_PADDING = 10

// A metric's value (e.g. a long formatted date) can wrap to more than one
// line in a narrow column. The label position and box height must be
// derived from the actual wrapped line count, not a fixed offset — otherwise
// a wrapped second line collides with the label drawn underneath it.
function measureMetricHeight(ctx: PdfContext, value: string, width: number) {
  const valueLines = wrapText(value, ctx.bold, METRIC_VALUE_SIZE, width - 28)
  return (
    METRIC_TOP_PADDING +
    valueLines.length * METRIC_VALUE_LINE_HEIGHT +
    METRIC_LABEL_GAP +
    METRIC_BOTTOM_PADDING
  )
}

function drawMetric(ctx: PdfContext, label: string, value: string, x: number, width: number, height: number) {
  ensureSpace(ctx, height)
  const boxTop = ctx.y
  ctx.page.drawRectangle({
    x,
    y: boxTop - height,
    width,
    height,
    borderColor: LINE,
    borderWidth: 0.75,
    color: rgb(0.97, 0.98, 0.99),
  })

  const valueLines = wrapText(value, ctx.bold, METRIC_VALUE_SIZE, width - 28)
  let lastLineY = boxTop - METRIC_TOP_PADDING
  for (const line of valueLines) {
    ctx.page.drawText(line, { x: x + 14, y: lastLineY, size: METRIC_VALUE_SIZE, font: ctx.bold, color: INK })
    lastLineY -= METRIC_VALUE_LINE_HEIGHT
  }
  // lastLineY has already advanced one line height past the final value
  // line; step back up to that line's baseline before applying the gap.
  const labelY = lastLineY + METRIC_VALUE_LINE_HEIGHT - METRIC_LABEL_GAP

  ctx.page.drawText(label.toUpperCase(), {
    x: x + 14,
    y: labelY,
    size: 8,
    font: ctx.bold,
    color: MUTED,
  })
}

async function loadReportPayload(organizationId: string, interviewId: string): Promise<ReportPayload> {
  const interview = await prisma.interview.findFirst({
    where: {
      interviewId,
      organizationId,
    },
    select: {
      interviewId: true,
      status: true,
      createdAt: true,
      candidate: {
        select: {
          fullName: true,
        },
      },
      job: {
        select: {
          jobTitle: true,
        },
      },
      attempts: {
        orderBy: {
          startedAt: "desc",
        },
        take: 1,
        select: {
          attemptId: true,
          status: true,
          startedAt: true,
          endedAt: true,
          evaluation: {
            select: {
              finalScore: true,
              decision: true,
              aiSummary: true,
            },
          },
        },
      },
    },
  })

  if (!interview) {
    throw new ApiError(404, "INTERVIEW_NOT_FOUND", "Interview not found for this organization.")
  }

  const attempt = interview.attempts[0] ?? null
  const reportInterview: ReportInterview = {
    interviewId: interview.interviewId,
    attemptId: attempt?.attemptId ?? null,
    candidateName: interview.candidate.fullName || "Candidate",
    jobTitle: interview.job.jobTitle || "-",
    interviewStatus: interview.status,
    attemptStatus: attempt?.status ?? null,
    startedAt: attempt?.startedAt ?? null,
    endedAt: attempt?.endedAt ?? null,
    finalScore: attempt?.evaluation?.finalScore ?? null,
    decision: attempt?.evaluation?.decision ?? null,
    aiSummary: attempt?.evaluation?.aiSummary ?? null,
    createdAt: interview.createdAt,
  }

  if (!attempt?.attemptId || !isCompleted(reportInterview)) {
    throw new ApiError(409, "REPORT_NOT_READY", "Report download is available only after the interview is completed.")
  }

  const answerMap = await fetchAnswerSummaries([attempt.attemptId])
  const answers = answerMap.get(attempt.attemptId) ?? []
  const calculated = deriveResultFromAnswerSummaries(answers)
  const score = toNumberOrNull(reportInterview.finalScore) ?? calculated.score
  const decision = reportInterview.decision ?? calculated.decision
  const summary =
    reportInterview.aiSummary ??
    buildAnswerFallbackSummary(answers) ??
    "No VERIS narrative has been recorded yet. Review the transcript and answer-level feedback for available evidence."

  return {
    interview: reportInterview,
    score,
    decision,
    summary,
    answers,
  }
}

export async function generateCandidateReportPdf(organizationId: string, interviewId: string) {
  const payload = await loadReportPayload(organizationId, interviewId)
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ctx: PdfContext = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    regular,
    bold,
    y: PAGE_HEIGHT - MARGIN,
    pageNumber: 1,
  }

  ctx.page.drawText("HireVeri", {
    x: MARGIN,
    y: ctx.y,
    size: 15,
    font: bold,
    color: ACCENT,
  })
  ctx.page.drawText("Candidate Interview Report", {
    x: MARGIN,
    y: ctx.y - 32,
    size: 24,
    font: bold,
    color: INK,
  })
  ctx.y -= 62
  drawTextBlock(ctx, `${payload.interview.candidateName} - ${payload.interview.jobTitle}`, {
    size: 12,
    color: MUTED,
    lineHeight: 17,
  })
  ctx.y -= 12

  const metricWidth = (CONTENT_WIDTH - 24) / 3
  const metrics: Array<[string, string]> = [
    ["Score", formatScore(payload.score)],
    ["Decision", payload.decision || "-"],
    ["Completed", formatDate(payload.interview.endedAt || payload.interview.createdAt)],
  ]
  // All three boxes in the row share one height, sized to whichever value
  // needs the most lines, so the row stays aligned and nothing overlaps
  // regardless of which value (e.g. a long date) happens to wrap.
  const metricHeight = Math.max(
    ...metrics.map(([, value]) => measureMetricHeight(ctx, value, metricWidth)),
  )
  const metricTop = ctx.y
  metrics.forEach(([label, value], index) => {
    ctx.y = metricTop
    drawMetric(ctx, label, value, MARGIN + index * (metricWidth + 12), metricWidth, metricHeight)
  })
  ctx.y = metricTop - metricHeight - 20

  drawSectionTitle(ctx, "Executive Summary")
  drawTextBlock(ctx, payload.summary, { size: 10.5, lineHeight: 16 })

  drawSectionTitle(ctx, "Interview Metadata")
  const metadata = [
    ["Candidate", payload.interview.candidateName],
    ["Role", payload.interview.jobTitle],
    ["Interview ID", payload.interview.interviewId],
    ["Attempt ID", payload.interview.attemptId || "-"],
    ["Started", formatDate(payload.interview.startedAt)],
    ["Completed", formatDate(payload.interview.endedAt)],
  ]
  metadata.forEach(([label, value]) => {
    ensureSpace(ctx, 18)
    ctx.page.drawText(`${label}:`, { x: MARGIN, y: ctx.y, size: 10, font: bold, color: MUTED })
    drawTextBlock(ctx, value, { x: MARGIN + 90, size: 10, maxWidth: CONTENT_WIDTH - 90, lineHeight: 14 })
  })

  drawSectionTitle(ctx, "Question, Answer, And Evaluation")
  if (payload.answers.length === 0) {
    drawTextBlock(ctx, "No answer transcript has been recorded for this completed interview yet.", { color: MUTED })
  } else {
    payload.answers.forEach((answer, index) => {
      ensureSpace(ctx, 84)
      drawTextBlock(ctx, `Question ${answer.questionOrder ?? index + 1}: ${answer.question}`, {
        size: 11,
        font: bold,
        lineHeight: 16,
      })
      if (answer.skill || answer.questionType) {
        drawTextBlock(ctx, [answer.skill, answer.questionType].filter(Boolean).join(" | "), {
          size: 8.5,
          color: MUTED,
          lineHeight: 12,
        })
      }
      drawTextBlock(ctx, `Candidate answer: ${answer.answerText || "No response provided."}`, {
        size: 9.5,
        lineHeight: 14,
      })
      const metrics = [
        answer.score !== null && answer.score !== undefined ? `Score ${formatScore(toNumberOrNull(answer.score))}` : null,
        answer.skillScore !== null && answer.skillScore !== undefined ? `Skill ${formatScore(toNumberOrNull(answer.skillScore))}` : null,
        answer.clarityScore !== null && answer.clarityScore !== undefined ? `Clarity ${formatScore(toNumberOrNull(answer.clarityScore))}` : null,
        answer.depthScore !== null && answer.depthScore !== undefined ? `Depth ${formatScore(toNumberOrNull(answer.depthScore))}` : null,
        answer.confidenceScore !== null && answer.confidenceScore !== undefined ? `Confidence ${formatScore(toNumberOrNull(answer.confidenceScore))}` : null,
        answer.fraudScore !== null && answer.fraudScore !== undefined ? `Review Flag ${formatScore(toNumberOrNull(answer.fraudScore))}` : null,
      ].filter(Boolean).join(" | ")
      if (metrics) {
        drawTextBlock(ctx, metrics, { size: 8.5, color: ACCENT, lineHeight: 12 })
      }
      drawTextBlock(ctx, `VERIS feedback: ${answer.feedback || "No VERIS feedback has been recorded for this answer."}`, {
        size: 9.5,
        color: MUTED,
        lineHeight: 14,
      })
      ctx.y -= 10
    })
  }

  addFooter(ctx)
  const bytes = await doc.save()
  const filename = `${sanitizeFilename(payload.interview.candidateName)}-${sanitizeFilename(payload.interview.jobTitle)}-report.pdf`

  return {
    bytes,
    filename,
  }
}
