import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { Prisma } from "@prisma/client"

import type { RecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { downloadInvoicePdf, uploadInvoicePdf } from "@/lib/server/invoice-storage"
import { prisma } from "@/lib/server/prisma"
import { sendBillingInvoiceEmail } from "@/lib/services/email.service"

type InvoiceSourceRow = {
  payment_id: string
  subscription_id: string
  organization_id: string
  user_id: string
  recruiter_email: string | null
  invoice_recipient_email: string | null
  recruiter_name: string | null
  organization_name: string
  gst_number: string | null
  billing_address: string | null
  plan_name: string
  interview_credits: number
  screening_credits: number
  original_amount_paise: number
  discount_amount_paise: number
  gst_percentage: number
  gst_amount_paise: number
  final_amount_paise: number
  currency: string
  coupon_code: string | null
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  payment_date: Date | null
  customer_country_code: string
  tax_treatment: string
}

type InvoiceRow = {
  id: string
  organization_id: string
  subscription_id: string
  payment_id: string
  invoice_number: string
  invoice_date: Date
  recruiter_email: string | null
  organization_name: string
  gst_number: string | null
  billing_address: string | null
  plan_name: string
  interview_credits: number
  screening_credits: number
  original_amount_paise: number
  discount_amount_paise: number
  taxable_amount_paise: number
  gst_percentage: number
  gst_amount_paise: number
  final_amount_paise: number
  currency: string
  coupon_code: string | null
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  invoice_pdf_url: string | null
  invoice_pdf_bucket: string | null
  invoice_pdf_key: string | null
  invoice_pdf_data: Buffer | Uint8Array | null
  email_sent_at: Date | null
  created_at: Date
  customer_country_code?: string
  tax_treatment?: string
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 48

function formatPaise(value: number, currency = "INR") {
  return `${currency} ${(Number(value || 0) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value))
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value))
}

function normalizeText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function getRecruiterAppUrl() {
  return (
    process.env.NEXT_PUBLIC_RECRUITER_APP_URL ||
    process.env.RECRUITER_APP_URL ||
    "https://recruiter.verisnova.com"
  ).replace(/\/+$/, "")
}

function getInvoiceDownloadUrl(invoiceId: string) {
  return `${getRecruiterAppUrl()}/api/billing/invoices/${invoiceId}/download`
}

function drawTextBlock(input: {
  page: import("pdf-lib").PDFPage
  text: string
  x: number
  y: number
  maxWidth: number
  font: import("pdf-lib").PDFFont
  size: number
  color?: ReturnType<typeof rgb>
  lineHeight?: number
}) {
  const { page, text, x, maxWidth, font, size } = input
  const color = input.color ?? rgb(0.15, 0.19, 0.27)
  const lineHeight = input.lineHeight ?? size + 5
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }

  if (current) lines.push(current)

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: input.y - index * lineHeight,
      size,
      font,
      color,
    })
  })

  return input.y - Math.max(0, lines.length - 1) * lineHeight
}

function drawKeyValue(input: {
  page: import("pdf-lib").PDFPage
  label: string
  value: string
  x: number
  y: number
  labelWidth?: number
  font: import("pdf-lib").PDFFont
  bold: import("pdf-lib").PDFFont
}) {
  const labelWidth = input.labelWidth ?? 116
  input.page.drawText(input.label, {
    x: input.x,
    y: input.y,
    size: 9,
    font: input.font,
    color: rgb(0.39, 0.45, 0.55),
  })
  input.page.drawText(input.value || "-", {
    x: input.x + labelWidth,
    y: input.y,
    size: 10,
    font: input.bold,
    color: rgb(0.07, 0.11, 0.18),
  })
}

function drawRightAlignedText(input: {
  page: import("pdf-lib").PDFPage
  text: string
  xRight: number
  y: number
  font: import("pdf-lib").PDFFont
  size: number
  color?: ReturnType<typeof rgb>
}) {
  const width = input.font.widthOfTextAtSize(input.text, input.size)
  input.page.drawText(input.text, {
    x: input.xRight - width,
    y: input.y,
    size: input.size,
    font: input.font,
    color: input.color ?? rgb(0.07, 0.11, 0.18),
  })
}

function getBillingSupportEmail() {
  return process.env.BILLING_SUPPORT_EMAIL?.trim() || process.env.SUPPORT_EMAIL_TO?.trim() || "support@verisnova.com"
}

function getBusinessGstin() {
  return process.env.VERIXANS_GSTIN?.trim() || "Pending / Not Available"
}

function getBusinessAddress() {
  return process.env.VERIXANS_REGISTERED_OFFICE?.trim() || "Registered office address will appear on issued GST records when available."
}

function getWebsiteUrl() {
  return process.env.NEXT_PUBLIC_HIREVERI_SITE_URL?.trim() || "https://verisnova.com"
}

export async function generateInvoicePdf(input: InvoiceSourceRow & { invoice_number: string; invoice_date: Date }) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const taxableAmountPaise = Math.max(0, input.original_amount_paise - input.discount_amount_paise)
  const generatedAt = new Date()
  const contentWidth = PAGE_WIDTH - MARGIN * 2
  const rightEdge = PAGE_WIDTH - MARGIN
  const navy = rgb(0.06, 0.09, 0.16)
  const muted = rgb(0.38, 0.44, 0.54)
  const border = rgb(0.84, 0.88, 0.93)
  const panel = rgb(0.98, 0.99, 1)

  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 132, width: PAGE_WIDTH, height: 132, color: rgb(0.965, 0.98, 1) })
  page.drawText("VerisNova", { x: MARGIN, y: PAGE_HEIGHT - 58, size: 30, font: bold, color: navy })
  page.drawText("Verixans Technologies Pvt Ltd", { x: MARGIN, y: PAGE_HEIGHT - 82, size: 11, font: bold, color: rgb(0.24, 0.3, 0.4) })
  page.drawText(getWebsiteUrl(), { x: MARGIN, y: PAGE_HEIGHT - 101, size: 9, font: regular, color: muted })
  drawRightAlignedText({ page, text: input.tax_treatment === "EXPORT_UNDER_LUT" ? "EXPORT INVOICE" : "TAX INVOICE", xRight: rightEdge, y: PAGE_HEIGHT - 56, size: 17, font: bold, color: navy })
  drawRightAlignedText({ page, text: input.invoice_number, xRight: rightEdge, y: PAGE_HEIGHT - 78, size: 11, font: bold, color: rgb(0.17, 0.27, 0.46) })
  drawRightAlignedText({ page, text: "Status: PAID", xRight: rightEdge, y: PAGE_HEIGHT - 99, size: 10, font: bold, color: rgb(0.02, 0.42, 0.26) })

  const businessY = PAGE_HEIGHT - 168
  page.drawText("From", { x: MARGIN, y: businessY, size: 9, font: bold, color: muted })
  page.drawText("Verixans Technologies Pvt Ltd", { x: MARGIN, y: businessY - 18, size: 11, font: bold, color: navy })
  drawTextBlock({ page, text: getBusinessAddress(), x: MARGIN, y: businessY - 36, maxWidth: 220, font: regular, size: 9, color: muted, lineHeight: 13 })
  page.drawText(`GSTIN: ${getBusinessGstin()}`, { x: MARGIN, y: businessY - 76, size: 9, font: regular, color: muted })
  page.drawText(`Support: ${getBillingSupportEmail()}`, { x: MARGIN, y: businessY - 92, size: 9, font: regular, color: muted })

  page.drawText("Bill to", { x: 330, y: businessY, size: 9, font: bold, color: muted })
  page.drawText(input.organization_name, { x: 330, y: businessY - 18, size: 11, font: bold, color: navy })
  page.drawText(`Recruiter: ${input.recruiter_email || "-"}`, { x: 330, y: businessY - 38, size: 9, font: regular, color: muted })
  page.drawText(input.customer_country_code === "IN" ? `GSTIN: ${input.gst_number || "Pending / Not Available"}` : `Country: ${input.customer_country_code}`, { x: 330, y: businessY - 55, size: 9, font: regular, color: muted })
  drawTextBlock({
    page,
    text: input.billing_address || "Billing address not provided",
    x: 330,
    y: businessY - 72,
    maxWidth: 205,
    font: regular,
    size: 9,
    color: muted,
    lineHeight: 13,
  })

  const metaY = PAGE_HEIGHT - 298
  page.drawRectangle({ x: MARGIN, y: metaY - 72, width: contentWidth, height: 94, color: panel, borderColor: border, borderWidth: 1 })
  const metaRows = [
    ["Invoice date", formatDate(input.invoice_date), "Payment date", formatDateTime(input.payment_date ?? input.invoice_date)],
    ["Generated", formatDateTime(generatedAt), "Currency", input.currency],
    ["Razorpay verification", "Verified", "Backend verification", "Completed"],
    ["Razorpay order", input.razorpay_order_id || "-", "Payment ID", input.razorpay_payment_id || "-"],
  ]
  metaRows.forEach(([leftLabel, leftValue, rightLabel, rightValue], index) => {
    const y = metaY - index * 20
    page.drawText(leftLabel, { x: MARGIN + 16, y, size: 8, font: regular, color: muted })
    page.drawText(leftValue, { x: MARGIN + 112, y, size: 9, font: bold, color: navy })
    page.drawText(rightLabel, { x: 318, y, size: 8, font: regular, color: muted })
    drawTextBlock({ page, text: rightValue, x: 414, y, maxWidth: 126, font: bold, size: 9, color: navy, lineHeight: 11 })
  })

  const tableTop = PAGE_HEIGHT - 420
  page.drawText("Subscription details", { x: MARGIN, y: tableTop + 26, size: 13, font: bold, color: navy })
  page.drawRectangle({ x: MARGIN, y: tableTop - 82, width: contentWidth, height: 92, borderColor: border, borderWidth: 1 })
  page.drawRectangle({ x: MARGIN, y: tableTop - 18, width: contentWidth, height: 28, color: rgb(0.95, 0.97, 1) })
  page.drawText("Description", { x: MARGIN + 16, y: tableTop - 8, size: 8, font: bold, color: muted })
  page.drawText("Credits", { x: 332, y: tableTop - 8, size: 8, font: bold, color: muted })
  drawRightAlignedText({ page, text: "Amount", xRight: rightEdge - 16, y: tableTop - 8, size: 8, font: bold, color: muted })
  drawTextBlock({ page, text: input.plan_name, x: MARGIN + 16, y: tableTop - 44, maxWidth: 250, font: bold, size: 11, color: navy, lineHeight: 14 })
  page.drawText(`${input.interview_credits} interview credits`, { x: 332, y: tableTop - 40, size: 9, font: regular, color: rgb(0.21, 0.27, 0.36) })
  page.drawText(`${input.screening_credits} screening credits`, { x: 332, y: tableTop - 57, size: 9, font: regular, color: rgb(0.21, 0.27, 0.36) })
  drawRightAlignedText({ page, text: formatPaise(input.original_amount_paise, input.currency), xRight: rightEdge - 16, y: tableTop - 47, size: 10, font: bold, color: navy })

  const verifyY = PAGE_HEIGHT - 552
  page.drawRectangle({ x: MARGIN, y: verifyY - 62, width: 225, height: 76, color: panel, borderColor: border, borderWidth: 1 })
  page.drawText("Payment verification", { x: MARGIN + 14, y: verifyY - 10, size: 10, font: bold, color: navy })
  ;["Razorpay verified payment", "Backend signature validated", "Subscription activated"].forEach((item, index) => {
    page.drawText("OK", { x: MARGIN + 14, y: verifyY - 30 - index * 16, size: 8, font: bold, color: rgb(0.02, 0.42, 0.26) })
    page.drawText(item, { x: MARGIN + 34, y: verifyY - 30 - index * 16, size: 9, font: regular, color: muted })
  })

  const totalsX = 330
  const totalsY = PAGE_HEIGHT - 536
  const totalRows = [
    ["Original amount", formatPaise(input.original_amount_paise, input.currency)],
    ["Coupon discount", `-${formatPaise(input.discount_amount_paise, input.currency)}`],
    ["Taxable amount", formatPaise(taxableAmountPaise, input.currency)],
    [input.tax_treatment === "EXPORT_UNDER_LUT" ? "IGST 0% (export under LUT)" : `GST ${Number(input.gst_percentage)}%`, formatPaise(input.gst_amount_paise, input.currency)],
  ]
  totalRows.forEach(([label, value], index) => {
    const y = totalsY - index * 22
    page.drawText(label, { x: totalsX, y, size: 9, font: regular, color: muted })
    drawRightAlignedText({ page, text: value, xRight: rightEdge, y, size: 10, font: bold, color: navy })
  })
  page.drawLine({ start: { x: totalsX, y: totalsY - 90 }, end: { x: rightEdge, y: totalsY - 90 }, thickness: 1.2, color: rgb(0.72, 0.78, 0.86) })
  page.drawText("Final paid", { x: totalsX, y: totalsY - 122, size: 13, font: bold, color: navy })
  drawRightAlignedText({ page, text: formatPaise(input.final_amount_paise, input.currency), xRight: rightEdge, y: totalsY - 126, size: 16, font: bold, color: navy })

  const footerY = 112
  page.drawRectangle({ x: MARGIN, y: footerY, width: contentWidth, height: 104, color: panel, borderColor: border, borderWidth: 1 })
  page.drawText("Billing and procurement note", { x: MARGIN + 16, y: footerY + 76, size: 10, font: bold, color: navy })
  drawTextBlock({
    page,
    text: "This invoice was generated after backend payment verification, Razorpay order validation, and organization subscription activation. Keep this document for GST reconciliation, procurement records, and audit review.",
    x: MARGIN + 16,
    y: footerY + 58,
    maxWidth: contentWidth - 32,
    font: regular,
    size: 9,
    color: rgb(0.27, 0.33, 0.42),
    lineHeight: 13,
  })
  drawTextBlock({
    page,
    text: `Support: ${getBillingSupportEmail()}`,
    x: MARGIN + 16,
    y: footerY + 18,
    maxWidth: 275,
    font: bold,
    size: 9,
    color: rgb(0.15, 0.23, 0.4),
    lineHeight: 12,
  })
  drawRightAlignedText({ page, text: `Generated ${formatDateTime(generatedAt)}`, xRight: rightEdge - 16, y: footerY + 4, size: 8, font: regular, color: muted })
  page.drawText("Generated by VerisNova Billing Infrastructure", { x: MARGIN, y: 72, size: 8, font: regular, color: rgb(0.45, 0.51, 0.6) })

  return Buffer.from(await pdf.save())
}

async function getNextInvoiceNumber(client: typeof prisma | Prisma.TransactionClient) {
  const rows = await client.$queryRaw<Array<{ sequence_value: bigint }>>(Prisma.sql`
    select nextval('public.verisnova_invoice_number_seq') as sequence_value
  `)
  const sequenceValue = Number(rows[0]?.sequence_value ?? 1)
  const year = new Date().getFullYear()
  return `HV-${year}-${String(sequenceValue).padStart(6, "0")}`
}

async function getInvoiceSource(paymentId: string) {
  const rows = await prisma.$queryRaw<InvoiceSourceRow[]>(Prisma.sql`
    select
      p.id as payment_id,
      p."subscriptionId" as subscription_id,
      p."organizationId"::text as organization_id,
      p."userId" as user_id,
      u.email as recruiter_email,
      coalesce(o.invoice_recipient_email, o.finance_email, u.email) as invoice_recipient_email,
      u.full_name as recruiter_name,
      o.organization_name,
      o.gst_number,
      o.billing_address,
      case
        when apl.id is not null then pl.name || ' + ' || apl.name
        else pl.name
      end as plan_name,
      pl."interviewLimit" + coalesce(apl."interviewLimit", 0) as interview_credits,
      pl."screeningCredits" + coalesce(apl."screeningCredits", 0) as screening_credits,
      coalesce(p."originalAmountPaise", p.amount) as original_amount_paise,
      coalesce(p."discountAmountPaise", 0) as discount_amount_paise,
      coalesce(p."gstPercentage", 18)::float8 as gst_percentage,
      coalesce(p."gstAmountPaise", 0) as gst_amount_paise,
      coalesce(p."finalAmountPaise", p.amount) as final_amount_paise,
      coalesce(p.currency, 'INR') as currency,
      coalesce(p.customer_country_code, 'IN') as customer_country_code,
      coalesce(p.tax_treatment, 'DOMESTIC_GST') as tax_treatment,
      p."couponCode" as coupon_code,
      p."razorpayOrderId" as razorpay_order_id,
      p."razorpayPaymentId" as razorpay_payment_id,
      coalesce(p."updatedAt", p."createdAt") as payment_date
    from public.hireveri_payments p
    inner join public.organizations o on o.organization_id = p."organizationId"
    inner join public.users u on u.user_id = p."userId"::uuid
    inner join public.hireveri_plans pl on pl.id = p."planId"
    left join public.hireveri_plans apl on apl.id = p."addonPlanId"
    where p.id = ${paymentId}
      and p.status = 'success'::"PaymentStatus"
    limit 1
  `)

  if (!rows[0]) {
    throw new ApiError(404, "PAID_PAYMENT_NOT_FOUND", "Paid payment was not found")
  }

  return rows[0]
}

function mapInvoice(row: InvoiceRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    subscriptionId: row.subscription_id,
    paymentId: row.payment_id,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    recruiterEmail: row.recruiter_email,
    organizationName: row.organization_name,
    gstNumber: row.gst_number,
    billingAddress: row.billing_address,
    planName: row.plan_name,
    interviewCredits: Number(row.interview_credits ?? 0),
    screeningCredits: Number(row.screening_credits ?? 0),
    originalAmountPaise: Number(row.original_amount_paise ?? 0),
    discountAmountPaise: Number(row.discount_amount_paise ?? 0),
    taxableAmountPaise: Number(row.taxable_amount_paise ?? 0),
    gstPercentage: Number(row.gst_percentage ?? 0),
    gstAmountPaise: Number(row.gst_amount_paise ?? 0),
    finalAmountPaise: Number(row.final_amount_paise ?? 0),
    currency: row.currency,
    customerCountryCode: row.customer_country_code ?? "IN",
    taxTreatment: row.tax_treatment ?? "DOMESTIC_GST",
    couponCode: row.coupon_code,
    razorpayOrderId: row.razorpay_order_id,
    razorpayPaymentId: row.razorpay_payment_id,
    invoicePdfUrl: row.invoice_pdf_url,
    emailSentAt: row.email_sent_at,
    createdAt: row.created_at,
  }
}

async function getExistingInvoiceByPayment(paymentId: string) {
  const rows = await prisma.$queryRaw<InvoiceRow[]>(Prisma.sql`
    select
      id::text,
      organization_id::text,
      subscription_id,
      payment_id,
      invoice_number,
      invoice_date,
      recruiter_email,
      organization_name,
      gst_number,
      billing_address,
      plan_name,
      interview_credits,
      screening_credits,
      original_amount_paise,
      discount_amount_paise,
      taxable_amount_paise,
      gst_percentage::float8 as gst_percentage,
      gst_amount_paise,
      final_amount_paise,
      currency,
      customer_country_code,
      tax_treatment,
      coupon_code,
      razorpay_order_id,
      razorpay_payment_id,
      invoice_pdf_url,
      invoice_pdf_bucket,
      invoice_pdf_key,
      invoice_pdf_data,
      email_sent_at,
      created_at
    from public.invoices
    where payment_id = ${paymentId}
    limit 1
  `)

  return rows[0] ?? null
}

export async function createAndSendInvoiceForPayment(input: { paymentId: string }) {
  const existing = await getExistingInvoiceByPayment(input.paymentId)
  const existingHasPdf = Boolean(existing?.invoice_pdf_data || (existing?.invoice_pdf_bucket && existing?.invoice_pdf_key))
  if (existing && existingHasPdf && existing.email_sent_at) {
    return mapInvoice(existing)
  }

  const source = await getInvoiceSource(input.paymentId)
  const invoiceNumber = existing?.invoice_number ?? await getNextInvoiceNumber(prisma)
  const invoiceDate = existing?.invoice_date ?? new Date()
  const taxableAmountPaise = Math.max(0, Number(source.original_amount_paise) - Number(source.discount_amount_paise))
  const pdf = await generateInvoicePdf({
    ...source,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
  })
  const stored = await uploadInvoicePdf({
    organizationId: source.organization_id,
    invoiceNumber,
    buffer: pdf,
  }).catch((error) => {
    console.error("Invoice object storage upload failed; using database PDF fallback", error)
    return null
  })

  const invoiceRows = await prisma.$queryRaw<InvoiceRow[]>(Prisma.sql`
    insert into public.invoices (
      organization_id,
      subscription_id,
      payment_id,
      invoice_number,
      invoice_date,
      recruiter_email,
      organization_name,
      gst_number,
      billing_address,
      plan_name,
      interview_credits,
      screening_credits,
      original_amount_paise,
      discount_amount_paise,
      taxable_amount_paise,
      gst_percentage,
      gst_amount_paise,
      final_amount_paise,
      currency,
      coupon_code,
      razorpay_order_id,
      razorpay_payment_id,
      invoice_pdf_url,
      invoice_pdf_bucket,
      invoice_pdf_key,
      invoice_pdf_data,
      created_at
    )
    values (
      ${source.organization_id}::uuid,
      ${source.subscription_id},
      ${source.payment_id},
      ${invoiceNumber},
      ${invoiceDate},
      ${source.recruiter_email},
      ${source.organization_name},
      ${source.gst_number},
      ${source.billing_address},
      ${source.plan_name},
      ${Number(source.interview_credits ?? 0)},
      ${Number(source.screening_credits ?? 0)},
      ${Number(source.original_amount_paise ?? 0)},
      ${Number(source.discount_amount_paise ?? 0)},
      ${taxableAmountPaise},
      ${Number(source.gst_percentage ?? 18)},
      ${Number(source.gst_amount_paise ?? 0)},
      ${Number(source.final_amount_paise ?? 0)},
      ${source.currency},
      ${source.customer_country_code},
      ${source.tax_treatment},
      ${source.coupon_code},
      ${source.razorpay_order_id},
      ${source.razorpay_payment_id},
      ${stored?.url ?? null},
      ${stored?.bucket ?? null},
      ${stored?.key ?? null},
      ${pdf},
      now()
    )
    on conflict (payment_id) do update set
      invoice_number = public.invoices.invoice_number,
      invoice_date = public.invoices.invoice_date,
      invoice_pdf_url = excluded.invoice_pdf_url,
      invoice_pdf_bucket = excluded.invoice_pdf_bucket,
      invoice_pdf_key = excluded.invoice_pdf_key,
      invoice_pdf_data = excluded.invoice_pdf_data
    returning
      id::text,
      organization_id::text,
      subscription_id,
      payment_id,
      invoice_number,
      invoice_date,
      recruiter_email,
      organization_name,
      gst_number,
      billing_address,
      plan_name,
      interview_credits,
      screening_credits,
      original_amount_paise,
      discount_amount_paise,
      taxable_amount_paise,
      gst_percentage::float8 as gst_percentage,
      gst_amount_paise,
      final_amount_paise,
      currency,
      coupon_code,
      razorpay_order_id,
      razorpay_payment_id,
      invoice_pdf_url,
      invoice_pdf_bucket,
      invoice_pdf_key,
      invoice_pdf_data,
      email_sent_at,
      created_at
  `)

  const invoice = invoiceRows[0]

  const recipientEmail = source.invoice_recipient_email || source.recruiter_email
  let emailSentAt = invoice.email_sent_at

  if (recipientEmail && !invoice.email_sent_at) {
    try {
      await sendBillingInvoiceEmail({
        to: recipientEmail,
        recruiterName: source.recruiter_name,
        organizationName: source.organization_name,
        planName: source.plan_name,
        invoiceNumber,
        invoiceDate: formatDate(invoiceDate),
        finalAmountLabel: formatPaise(source.final_amount_paise, source.currency),
        interviewCredits: Number(source.interview_credits ?? 0),
        screeningCredits: Number(source.screening_credits ?? 0),
        razorpayOrderId: source.razorpay_order_id,
        razorpayPaymentId: source.razorpay_payment_id,
        invoicePdfFileName: `${sanitizeFileName(invoiceNumber)}.pdf`,
        invoicePdfBase64: pdf.toString("base64"),
        invoiceDownloadUrl: getInvoiceDownloadUrl(invoice.id),
      })
      await prisma.$executeRaw(Prisma.sql`
        update public.invoices
        set email_sent_at = now()
        where id = ${invoice.id}::uuid
      `)
      emailSentAt = new Date()
    } catch (error) {
      console.error("Billing invoice email failed", error)
    }
  }

  return mapInvoice({
    ...invoice,
      email_sent_at: emailSentAt,
  })
}

async function ensureInvoicesForOrganization(auth: RecruiterRequestContext) {
  const rows = await prisma.$queryRaw<Array<{ payment_id: string }>>(Prisma.sql`
    select p.id as payment_id
    from public.hireveri_payments p
    left join public.invoices i on i.payment_id = p.id
    where p."organizationId" = ${auth.organizationId}::uuid
      and p.status = 'success'::"PaymentStatus"
      and (
        i.id is null
        or (
          i.invoice_pdf_data is null
          and (i.invoice_pdf_bucket is null or i.invoice_pdf_key is null)
        )
        or i.email_sent_at is null
      )
    order by p."createdAt" desc
    limit 10
  `)

  for (const row of rows) {
    try {
      await createAndSendInvoiceForPayment({ paymentId: row.payment_id })
    } catch (error) {
      console.error("Billing invoice backfill failed", { paymentId: row.payment_id, error })
    }
  }
}

export async function listOrganizationInvoices(auth: RecruiterRequestContext) {
  const rows = await prisma.$queryRaw<InvoiceRow[]>(Prisma.sql`
    select
      id::text,
      organization_id::text,
      subscription_id,
      payment_id,
      invoice_number,
      invoice_date,
      recruiter_email,
      organization_name,
      gst_number,
      billing_address,
      plan_name,
      interview_credits,
      screening_credits,
      original_amount_paise,
      discount_amount_paise,
      taxable_amount_paise,
      gst_percentage::float8 as gst_percentage,
      gst_amount_paise,
      final_amount_paise,
      currency,
      coupon_code,
      razorpay_order_id,
      razorpay_payment_id,
      invoice_pdf_url,
      invoice_pdf_bucket,
      invoice_pdf_key,
      invoice_pdf_data,
      email_sent_at,
      created_at
    from public.invoices
    where organization_id = ${auth.organizationId}::uuid
    order by invoice_date desc, created_at desc
  `)

  return rows.map(mapInvoice)
}

export async function getOrganizationBillingHistory(auth: RecruiterRequestContext) {
  await ensureInvoicesForOrganization(auth)

  const [invoices, organizationRows, subscriptionRows, paymentRows, screeningUsageRows] = await Promise.all([
    listOrganizationInvoices(auth),
    prisma.$queryRaw<
      Array<{
        organization_id: string
        organization_name: string
        gst_number: string | null
        billing_address: string | null
        finance_email: string | null
        invoice_recipient_email: string | null
        billing_country_code: string
      }>
    >(Prisma.sql`
      select
        organization_id::text,
        organization_name,
        gst_number,
        billing_address,
        finance_email,
        invoice_recipient_email,
        billing_country_code
      from public.organizations
      where organization_id = ${auth.organizationId}::uuid
      limit 1
    `),
    prisma.$queryRaw<
      Array<{
        id: string
        plan_name: string | null
        plan_id: string
        status: string
        total_credits: number
        used_credits: number
        screening_credits: number
        amount_paid: number
        currency: string
        activated_at: Date | null
        expires_at: Date | null
      }>
    >(Prisma.sql`
      select
        s.id,
        p.name as plan_name,
        s."planId" as plan_id,
        s.status,
        s."totalCredits" as total_credits,
        s."usedCredits" as used_credits,
        s."screeningCredits" as screening_credits,
        s."amountPaid" as amount_paid,
        s.currency,
        s."activatedAt" as activated_at,
        s."expiresAt" as expires_at
      from public.hireveri_user_subscriptions s
      left join public.hireveri_plans p on p.id = s."planId"
      where s."organizationId" = ${auth.organizationId}::uuid
      order by s."updatedAt" desc
      limit 10
    `),
    prisma.$queryRaw<
      Array<{
        id: string
        plan_id: string | null
        plan_name: string | null
        invoice_number: string | null
        invoice_id: string | null
        coupon_code: string | null
        taxable_amount_paise: number | null
        gst_amount_paise: number | null
        discount_amount_paise: number | null
        amount: number
        final_amount_paise: number | null
        currency: string | null
        status: string
        razorpay_order_id: string | null
        razorpay_payment_id: string | null
        created_at: Date
      }>
    >(Prisma.sql`
      select
        pay.id,
        pay."planId" as plan_id,
        case
          when ap.id is not null then p.name || ' + ' || ap.name
          else p.name
        end as plan_name,
        inv.invoice_number,
        inv.id::text as invoice_id,
        pay."couponCode" as coupon_code,
        pay."originalAmountPaise" - pay."discountAmountPaise" as taxable_amount_paise,
        pay."gstAmountPaise" as gst_amount_paise,
        pay."discountAmountPaise" as discount_amount_paise,
        pay.amount,
        pay."finalAmountPaise" as final_amount_paise,
        pay.currency,
        pay.status::text as status,
        pay."razorpayOrderId" as razorpay_order_id,
        pay."razorpayPaymentId" as razorpay_payment_id,
        pay."createdAt" as created_at
      from public.hireveri_payments pay
      left join public.hireveri_plans p on p.id = pay."planId"
      left join public.hireveri_plans ap on ap.id = pay."addonPlanId"
      left join public.invoices inv on inv.payment_id = pay.id
      where pay."organizationId" = ${auth.organizationId}::uuid
      order by pay."createdAt" desc
      limit 25
    `),
    prisma.$queryRaw<Array<{ used_screening_credits: number }>>(Prisma.sql`
      select coalesce(count(*), 0)::int as used_screening_credits
      from public.screening_runs
      where organization_id = ${auth.organizationId}::uuid
    `).catch(() => [{ used_screening_credits: 0 }]),
  ])
  const organization = organizationRows[0] ?? null
  const screeningUsed = Number(screeningUsageRows[0]?.used_screening_credits ?? 0)

  return {
    organization: organization
      ? {
          organizationId: organization.organization_id,
          organizationName: organization.organization_name,
          gstNumber: organization.gst_number,
          billingAddress: organization.billing_address,
          financeEmail: organization.finance_email,
          invoiceRecipientEmail: organization.invoice_recipient_email,
          billingCountryCode: organization.billing_country_code,
        }
      : null,
    invoices,
    subscriptions: subscriptionRows.map((row) => ({
      id: row.id,
      planName: row.plan_name,
      planId: row.plan_id,
      status: row.status,
      totalCredits: Number(row.total_credits ?? 0),
      usedCredits: Number(row.used_credits ?? 0),
      screeningCredits: Number(row.screening_credits ?? 0),
      usedScreeningCredits: screeningUsed,
      amountPaid: Number(row.amount_paid ?? 0),
      currency: row.currency,
      activatedAt: row.activated_at,
      expiresAt: row.expires_at,
    })),
    payments: paymentRows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      planName: row.plan_name,
      invoiceNumber: row.invoice_number,
      invoiceId: row.invoice_id,
      couponCode: row.coupon_code,
      taxableAmountPaise: Number(row.taxable_amount_paise ?? 0),
      gstAmountPaise: Number(row.gst_amount_paise ?? 0),
      discountAmountPaise: Number(row.discount_amount_paise ?? 0),
      amount: Number(row.final_amount_paise ?? row.amount ?? 0),
      currency: row.currency ?? "INR",
      status: row.status,
      razorpayOrderId: row.razorpay_order_id,
      razorpayPaymentId: row.razorpay_payment_id,
      createdAt: row.created_at,
    })),
  }
}

export async function updateOrganizationBillingSettings(input: {
  auth: RecruiterRequestContext
  gstNumber?: string | null
  billingAddress?: string | null
  financeEmail?: string | null
  invoiceRecipientEmail?: string | null
  billingCountryCode: string
}) {
  const normalizeNullable = (value: string | null | undefined) => {
    if (typeof value !== "string") {
      return null
    }

    const trimmed = value.trim()
    return trimmed || null
  }
  const rows = await prisma.$queryRaw<
    Array<{
      organization_id: string
      organization_name: string
      gst_number: string | null
      billing_address: string | null
      finance_email: string | null
      invoice_recipient_email: string | null
      billing_country_code: string
    }>
  >(Prisma.sql`
    update public.organizations
    set gst_number = ${normalizeNullable(input.gstNumber)},
        billing_address = ${normalizeNullable(input.billingAddress)},
        finance_email = ${normalizeNullable(input.financeEmail)},
        invoice_recipient_email = ${normalizeNullable(input.invoiceRecipientEmail)},
        billing_country_code = ${input.billingCountryCode.trim().toUpperCase()}
    where organization_id = ${input.auth.organizationId}::uuid
      and is_active = true
    returning
      organization_id::text,
      organization_name,
      gst_number,
      billing_address,
      finance_email,
      invoice_recipient_email,
      billing_country_code
  `)

  if (!rows[0]) {
    throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "Organization was not found")
  }

  return {
    organizationId: rows[0].organization_id,
    organizationName: rows[0].organization_name,
    gstNumber: rows[0].gst_number,
    billingAddress: rows[0].billing_address,
    financeEmail: rows[0].finance_email,
    invoiceRecipientEmail: rows[0].invoice_recipient_email,
    billingCountryCode: rows[0].billing_country_code,
  }
}

export async function getInvoicePdfForDownload(input: {
  auth: RecruiterRequestContext
  invoiceId: string
}) {
  const rows = await prisma.$queryRaw<InvoiceRow[]>(Prisma.sql`
    select
      id::text,
      organization_id::text,
      subscription_id,
      payment_id,
      invoice_number,
      invoice_date,
      recruiter_email,
      organization_name,
      gst_number,
      billing_address,
      plan_name,
      interview_credits,
      screening_credits,
      original_amount_paise,
      discount_amount_paise,
      taxable_amount_paise,
      gst_percentage::float8 as gst_percentage,
      gst_amount_paise,
      final_amount_paise,
      currency,
      coupon_code,
      razorpay_order_id,
      razorpay_payment_id,
      invoice_pdf_url,
      invoice_pdf_bucket,
      invoice_pdf_key,
      invoice_pdf_data,
      email_sent_at,
      created_at
    from public.invoices
    where id = ${input.invoiceId}::uuid
      and organization_id = ${input.auth.organizationId}::uuid
    limit 1
  `)
  const invoice = rows[0]

  if (!invoice) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found")
  }

  if (!invoice.invoice_pdf_bucket || !invoice.invoice_pdf_key) {
    if (invoice.invoice_pdf_data) {
      return {
        fileName: `${sanitizeFileName(invoice.invoice_number)}.pdf`,
        pdf: Buffer.from(invoice.invoice_pdf_data),
      }
    }

    throw new ApiError(404, "INVOICE_PDF_NOT_AVAILABLE", "Invoice PDF is not available")
  }

  const pdf = await downloadInvoicePdf({
    bucket: invoice.invoice_pdf_bucket,
    key: invoice.invoice_pdf_key,
  })

  return {
    fileName: `${sanitizeFileName(invoice.invoice_number)}.pdf`,
    pdf,
  }
}
