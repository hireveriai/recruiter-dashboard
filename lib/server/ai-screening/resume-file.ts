import { openAiFetch } from "@/lib/server/ai-usage-log"

type PdfTextContentItem = {
  str?: string
}

type PdfPageProxy = {
  getTextContent: () => Promise<{ items: PdfTextContentItem[] }>
  cleanup?: () => void
}

type PdfDocumentProxy = {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageProxy>
  destroy?: () => Promise<void>
}

type PdfLoadingTask = {
  promise: Promise<PdfDocumentProxy>
  destroy?: () => Promise<void>
}

type PdfWorkerModule = {
  WorkerMessageHandler?: unknown
}

type OpenAIResponsesOutputText = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      text?: string
      type?: string
    }>
  }>
}

const OCR_MODEL = process.env.OPENAI_RESUME_OCR_MODEL || "gpt-4o-mini"
const MIN_TEXT_LENGTH_FOR_RESUME = 40
const MAX_OCR_IMAGES = 3

/**
 * PostgreSQL text values cannot contain NUL bytes. Some otherwise valid PDFs
 * expose embedded font/control objects as standalone \u0000 text items, so clean
 * all parser and OCR output before it reaches AI parsing or persistence.
 */
export function sanitizeExtractedResumeText(text: string | null | undefined) {
  if (!text) {
    return null
  }

  const sanitized = text
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return sanitized || null
}

export function isSupportedResumeFile(file: File) {
  return isPdfFile(file) || isDocxFile(file)
}

export function getResumeFileKind(file: File) {
  if (isPdfFile(file)) {
    return "PDF"
  }

  if (isDocxFile(file)) {
    return "DOCX"
  }

  return "UNKNOWN"
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
}

function isDocxFile(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Unknown error"
}

async function ensurePdfDomPolyfills() {
  if (globalThis.DOMMatrix && globalThis.DOMPoint && globalThis.DOMRect) {
    return
  }

  const geometryModule = await import("@napi-rs/canvas/geometry.js")

  if (!globalThis.DOMMatrix && geometryModule.DOMMatrix) {
    globalThis.DOMMatrix = geometryModule.DOMMatrix as typeof DOMMatrix
  }

  if (!globalThis.DOMPoint && geometryModule.DOMPoint) {
    globalThis.DOMPoint = geometryModule.DOMPoint as typeof DOMPoint
  }

  if (!globalThis.DOMRect && geometryModule.DOMRect) {
    globalThis.DOMRect = geometryModule.DOMRect as typeof DOMRect
  }
}

async function ensurePdfWorkerModule() {
  const existingWorker = (globalThis as typeof globalThis & { pdfjsWorker?: PdfWorkerModule }).pdfjsWorker

  if (existingWorker?.WorkerMessageHandler) {
    return
  }

  const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs")
  ;(globalThis as typeof globalThis & { pdfjsWorker?: PdfWorkerModule }).pdfjsWorker =
    workerModule as PdfWorkerModule
}

async function ensurePdfServerRuntime() {
  await ensurePdfDomPolyfills()
  await ensurePdfWorkerModule()
}

async function extractPdfTextWithPdfJs(resumeBuffer: Buffer) {
  await ensurePdfServerRuntime()
  const pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs")

  const getDocument = pdfjsModule.getDocument as (options: {
    data: Uint8Array
    disableWorker?: boolean
    useWorkerFetch?: boolean
    isEvalSupported?: boolean
    useSystemFonts?: boolean
  }) => PdfLoadingTask

  const loadingTask = getDocument({
    data: new Uint8Array(resumeBuffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  })

  const pdfDocument = await loadingTask.promise

  try {
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber)

      try {
        const textContent = await page.getTextContent()
        const pageText = textContent.items
          .map((item) => item.str?.trim() ?? "")
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()

        if (pageText) {
          pages.push(pageText)
        }
      } finally {
        page.cleanup?.()
      }
    }

    return sanitizeExtractedResumeText(pages.join("\n"))
  } finally {
    await pdfDocument.destroy?.()
    await loadingTask.destroy?.()
  }
}

function hasMeaningfulResumeText(text: string | null | undefined) {
  const sanitized = sanitizeExtractedResumeText(text)
  return Boolean(sanitized && sanitized.replace(/\s+/g, " ").length >= MIN_TEXT_LENGTH_FOR_RESUME)
}

function extractStructuredOutputText(response: OpenAIResponsesOutputText) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim()
  }

  const fragments: string[] = []

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) {
        fragments.push(content.text.trim())
      }
    }
  }

  return sanitizeExtractedResumeText(fragments.join("\n")) ?? ""
}

async function extractTextWithVisionOcr(imageDataUrls: string[], sourceLabel: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim().replace(/^"|"$/g, "")

  if (!apiKey) {
    throw new Error(`${sourceLabel} appears to be image-based and requires OPENAI_API_KEY for OCR`)
  }

  const usableImages = imageDataUrls.filter(Boolean).slice(0, MAX_OCR_IMAGES)

  if (usableImages.length === 0) {
    return null
  }

  const response = await openAiFetch("https://api.openai.com/v1/responses", {
    aiUsage: {
      operation: "screening.resume_ocr_images",
      billing: { images: usableImages.length },
      meta: { source_label: sourceLabel },
    },
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Extract the resume text from the attached image-based resume page(s).",
                "Return only the readable resume text in a clean plain-text format.",
                "Preserve candidate name, contact details, headings, dates, skills, education, projects, and experience.",
                "Do not summarize and do not invent missing text.",
              ].join(" "),
            },
            ...usableImages.map((imageUrl) => ({
              type: "input_image",
              image_url: imageUrl,
            })),
          ],
        },
      ],
      temperature: 0,
    }),
  })

  if (!response.ok) {
    const message = await response.text().catch(() => "")
    throw new Error(`OpenAI OCR failed with status ${response.status}: ${message.slice(0, 300)}`)
  }

  const payload = (await response.json()) as OpenAIResponsesOutputText
  const text = extractStructuredOutputText(payload)

  return hasMeaningfulResumeText(text) ? text : null
}

async function extractPdfTextWithOcr(resumeBuffer: Buffer) {
  const apiKey = process.env.OPENAI_API_KEY?.trim().replace(/^"|"$/g, "")

  if (!apiKey) {
    throw new Error("PDF resume appears to be image-based and requires OPENAI_API_KEY for OCR")
  }

  const response = await openAiFetch("https://api.openai.com/v1/responses", {
    aiUsage: { operation: "screening.resume_ocr_pdf" },
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: "resume.pdf",
              file_data: `data:application/pdf;base64,${resumeBuffer.toString("base64")}`,
            },
            {
              type: "input_text",
              text: [
                "Extract the resume text from this PDF resume.",
                "Return only the readable resume text in clean plain text.",
                "Preserve candidate name, contact details, headings, dates, skills, education, projects, and experience.",
                "Do not summarize and do not invent missing text.",
              ].join(" "),
            },
          ],
        },
      ],
      temperature: 0,
    }),
  })

  if (!response.ok) {
    const message = await response.text().catch(() => "")
    throw new Error(`OpenAI PDF OCR failed with status ${response.status}: ${message.slice(0, 300)}`)
  }

  const payload = (await response.json()) as OpenAIResponsesOutputText
  const text = extractStructuredOutputText(payload)

  return hasMeaningfulResumeText(text) ? text : null
}

async function extractDocxText(resumeBuffer: Buffer) {
  const mammothModule = await import("mammoth")
  const mammoth = "default" in mammothModule ? mammothModule.default : mammothModule
  const parsed = await mammoth.extractRawText({ buffer: resumeBuffer })
  const text = sanitizeExtractedResumeText(parsed.value)

  return hasMeaningfulResumeText(text) ? text : null
}

async function extractDocxImageDataUrls(resumeBuffer: Buffer) {
  const mammothModule = await import("mammoth")
  const mammoth = "default" in mammothModule ? mammothModule.default : mammothModule
  const imageDataUrls: string[] = []

  await mammoth.convertToHtml(
    { buffer: resumeBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read("base64")
        const contentType = image.contentType || "image/png"
        const imageUrl = `data:${contentType};base64,${base64}`

        imageDataUrls.push(imageUrl)

        return { src: imageUrl }
      }),
    }
  )

  return imageDataUrls
}

async function extractDocxTextWithOcr(resumeBuffer: Buffer) {
  const imageDataUrls = await extractDocxImageDataUrls(resumeBuffer)
  return extractTextWithVisionOcr(imageDataUrls, "DOCX resume")
}

export async function extractResumeText(file: File, resumeBuffer: Buffer) {
  if (isPdfFile(file)) {
    const parserErrors: string[] = []

    try {
      const text = await extractPdfTextWithPdfJs(resumeBuffer)
      if (hasMeaningfulResumeText(text)) {
        return text
      }
      parserErrors.push("pdfjs-dist returned empty text")
    } catch (error) {
      parserErrors.push(`pdfjs-dist: ${getErrorMessage(error)}`)
    }

    try {
      const text = await extractPdfTextWithOcr(resumeBuffer)
      if (hasMeaningfulResumeText(text)) {
        return text
      }
      parserErrors.push("OCR returned empty text")
    } catch (error) {
      parserErrors.push(`OCR: ${getErrorMessage(error)}`)
    }

    throw new Error(parserErrors.join(" | "))
  }

  if (isDocxFile(file)) {
    const parserErrors: string[] = []

    try {
      const text = await extractDocxText(resumeBuffer)
      if (hasMeaningfulResumeText(text)) {
        return text
      }
      parserErrors.push("mammoth returned empty text")
    } catch (error) {
      parserErrors.push(`mammoth: ${getErrorMessage(error)}`)
    }

    try {
      const text = await extractDocxTextWithOcr(resumeBuffer)
      if (hasMeaningfulResumeText(text)) {
        return text
      }
      parserErrors.push("OCR returned empty text")
    } catch (error) {
      parserErrors.push(`OCR: ${getErrorMessage(error)}`)
    }

    throw new Error(parserErrors.join(" | "))
  }

  return null
}
