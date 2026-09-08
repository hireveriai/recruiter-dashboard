import { Prisma } from "@prisma/client"
import { randomBytes } from "crypto"
import { NextRequest } from "next/server"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"
import {
  sendSupportConfirmationEmail,
  sendSupportNotificationEmail,
} from "@/lib/services/email.service"

type SupportCategoryRow = {
  category_code: string
  label: string
  sort_order: number
}

type SupportConfigRow = {
  config_key: string
  label: string
  value: string
  sort_order: number
}

const PRIORITIES = ["Critical", "High", "Standard", "Low"]
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""
}

function generateReferenceId() {
  const date = new Date()
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("")
  return `VN-SUP-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`
}

function groupConfig(rows: SupportConfigRow[]) {
  return rows.reduce<Record<string, { label: string; value: string }[]>>((acc, row) => {
    const group = row.config_key
    acc[group] = acc[group] || []
    acc[group].push({ label: row.label, value: row.value })
    return acc
  }, {})
}

export async function GET() {
  try {
    const [categories, config] = await Promise.all([
      prisma.$queryRaw<SupportCategoryRow[]>(Prisma.sql`
        select category_code, label, sort_order
        from public.support_request_categories
        where is_active = true
        order by sort_order asc, label asc
      `),
      prisma.$queryRaw<SupportConfigRow[]>(Prisma.sql`
        select config_key, label, value, sort_order
        from public.support_center_seed_data
        where is_active = true
        order by config_key asc, sort_order asc
      `),
    ])

    return successResponse({
      categories: categories.map((category) => ({
        value: category.category_code,
        label: category.label,
      })),
      config: groupConfig(config),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const fullName = normalizeText(formData.get("fullName"))
    const workEmail = normalizeEmail(normalizeText(formData.get("workEmail")))
    const organization = normalizeText(formData.get("organization"))
    const priority = normalizeText(formData.get("priority"))
    const category = normalizeText(formData.get("category"))
    const message = normalizeText(formData.get("message"))
    const attachment = formData.get("attachment")

    if (!fullName || !workEmail || !organization || !priority || !category || !message) {
      throw new ApiError(400, "SUPPORT_REQUEST_REQUIRED_FIELDS", "All required support request fields must be completed.")
    }

    if (!PRIORITIES.includes(priority)) {
      throw new ApiError(400, "INVALID_PRIORITY", "Select a valid support priority.")
    }

    const categoryRows = await prisma.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
      select exists (
        select 1
        from public.support_request_categories
        where category_code = ${category}
          and is_active = true
      ) as exists
    `)

    if (!categoryRows[0]?.exists) {
      throw new ApiError(400, "INVALID_SUPPORT_CATEGORY", "Select a valid support category.")
    }

    let attachmentMetadata: Record<string, string | number> | null = null
    let attachmentBuffer: Buffer | null = null
    let attachmentBase64: string | null = null
    if (attachment instanceof File && attachment.size > 0) {
      if (attachment.size > MAX_ATTACHMENT_BYTES) {
        throw new ApiError(400, "ATTACHMENT_TOO_LARGE", "Attachment must be 8 MB or smaller.")
      }

      attachmentBuffer = Buffer.from(await attachment.arrayBuffer())
      attachmentBase64 = attachmentBuffer.toString("base64")
      attachmentMetadata = {
        name: attachment.name,
        type: attachment.type || "application/octet-stream",
        size: attachment.size,
      }
    }

    const referenceId = generateReferenceId()
    const rows = await prisma.$queryRaw<{ support_request_id: string; created_at: string }[]>(Prisma.sql`
      insert into public.support_requests (
        reference_id,
        full_name,
        work_email,
        organization,
        priority,
        category_code,
        message,
        attachment_metadata,
        attachment_filename,
        attachment_content_type,
        attachment_size_bytes,
        attachment_content,
        status,
        support_email_status,
        requester_email_status
      )
      values (
        ${referenceId},
        ${fullName},
        ${workEmail},
        ${organization},
        ${priority},
        ${category},
        ${message},
        ${attachmentMetadata ? JSON.stringify(attachmentMetadata) : null}::jsonb,
        ${attachmentMetadata?.name ? String(attachmentMetadata.name) : null},
        ${attachmentMetadata?.type ? String(attachmentMetadata.type) : null},
        ${attachmentMetadata?.size ? Number(attachmentMetadata.size) : null},
        ${attachmentBuffer},
        'OPEN',
        'PENDING',
        'PENDING'
      )
      returning support_request_id::text, created_at::text
    `)

    const emailPayload = {
      referenceId,
      fullName,
      workEmail,
      organization,
      priority,
      category,
      message,
      attachmentName: attachmentMetadata?.name ? String(attachmentMetadata.name) : null,
      attachmentContent: attachmentBase64,
    }

    const emailResults = await Promise.allSettled([
      sendSupportNotificationEmail(emailPayload),
      sendSupportConfirmationEmail(emailPayload),
    ])

    await prisma.$executeRaw(Prisma.sql`
      update public.support_requests
      set
        support_email_status = ${emailResults[0].status === "fulfilled" ? "SENT" : "FAILED"},
        requester_email_status = ${emailResults[1].status === "fulfilled" ? "SENT" : "FAILED"},
        support_email_error = ${emailResults[0].status === "rejected" ? String(emailResults[0].reason?.message || emailResults[0].reason || "Email failed") : null},
        requester_email_error = ${emailResults[1].status === "rejected" ? String(emailResults[1].reason?.message || emailResults[1].reason || "Email failed") : null},
        email_sent_at = case
          when ${emailResults.some((result) => result.status === "fulfilled")} then now()
          else null
        end,
        updated_at = now()
      where reference_id = ${referenceId}
    `)

    if (emailResults.some((result) => result.status === "rejected")) {
      throw new ApiError(502, "SUPPORT_EMAIL_FAILED", `Support request ${referenceId} was saved, but one or more emails could not be sent.`)
    }

    return successResponse(
      {
        referenceId,
        supportRequestId: rows[0]?.support_request_id,
        createdAt: rows[0]?.created_at,
      },
      201
    )
  } catch (error) {
    return errorResponse(error)
  }
}
