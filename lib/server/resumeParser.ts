export type ParsedResume = {
  name: string | null
  email: string | null
  phone: string | null
  skills: string[]
  experienceYears: number | null
  education: string[]
}

type OpenAIResponsesOutputText = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

const OPENAI_MODEL = "gpt-4o-mini"

const SKILL_KEYWORDS = [
  "JavaScript",
  "TypeScript",
  "Node.js",
  "React",
  "Next.js",
  "Express",
  "Python",
  "Java",
  "C++",
  "SQL",
  "SQL Server",
  "MSSQL",
  "PostgreSQL",
  "Postgres",
  "MySQL",
  "Oracle",
  "OBIEE",
  "MongoDB",
  "AWS",
  "Azure",
  "Azure SQL",
  "Azure Database for PostgreSQL",
  "GCP",
  "Docker",
  "Kubernetes",
  "Git",
  "REST API",
  "GraphQL",
  "Redis",
  "Linux",
  "Database Administration",
  "Database Administrator",
  "DBA",
  "Database Design",
  "Database Security",
  "SQL Performance Tuning",
  "Performance Tuning",
  "Backup",
  "Restore",
  "Disaster Recovery",
  "Data Migration",
  "Patching",
  "Log Analysis",
  "Monitoring",
  "PowerShell",
  "HTML",
  "CSS",
]

const EDUCATION_PATTERNS = [
  /\bb\.tech\b/gi,
  /\bbachelor(?:'s)?\b/gi,
  /\bb\.e\b/gi,
  /\bm\.tech\b/gi,
  /\bmaster(?:'s)?\b/gi,
  /\bmba\b/gi,
  /\bbca\b/gi,
  /\bmca\b/gi,
  /\bb\.sc\b/gi,
  /\bm\.sc\b/gi,
  /\bphd\b/gi,
]

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

export function normalizeCandidateName(value: unknown) {
  if (typeof value !== "string") return null

  const name = normalizeWhitespace(value)
  if (
    !name ||
    name.length > 80 ||
    !/[A-Za-z]/.test(name) ||
    /@|https?:\/\//i.test(name) ||
    /^(?:(?:candidate|applicant)\s+)?(?:cv|resume|curriculum\s+vitae|profile)(?:\s+(?:of|for)\s+(?:candidate|applicant))?$/i.test(name)
  ) {
    return null
  }

  return name
}

function extractEmail(text: string) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?.[0] ?? null
}

function extractPhone(text: string) {
  const match = text.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,6}/)
  return match?.[0]?.trim() ?? null
}

function extractSkills(text: string) {
  const lowerText = text.toLowerCase()

  return SKILL_KEYWORDS.filter((skill) => lowerText.includes(skill.toLowerCase()))
}

function extractExperienceYears(text: string) {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*\+?\s*years?/i,
    /experience\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\+?\s*years?/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const value = Number.parseFloat(match[1])
      if (!Number.isNaN(value)) {
        return value
      }
    }
  }

  return null
}

function extractEducation(text: string) {
  const matches = new Set<string>()

  for (const pattern of EDUCATION_PATTERNS) {
    const found = text.match(pattern) ?? []
    for (const item of found) {
      matches.add(item.replace(/\s+/g, " ").trim())
    }
  }

  return Array.from(matches)
}

function extractName(text: string, email: string | null) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)

  for (const line of lines.slice(0, 8)) {
    if (email && line.toLowerCase().includes(email.toLowerCase())) {
      continue
    }

    if (/\b(?:resume|curriculum vitae|cv|profile|summary|experience|education)\b/i.test(line)) {
      continue
    }

    if (/^[A-Za-z][A-Za-z .'-]{1,60}$/.test(line) && line.split(" ").length <= 5) {
      return line
    }
  }

  return null
}

function isParsedResume(value: unknown): value is ParsedResume {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    (candidate.name === null || typeof candidate.name === "string") &&
    (candidate.email === null || typeof candidate.email === "string") &&
    (candidate.phone === null || typeof candidate.phone === "string") &&
    Array.isArray(candidate.skills) &&
    candidate.skills.every((skill) => typeof skill === "string") &&
    (candidate.experienceYears === null || typeof candidate.experienceYears === "number") &&
    Array.isArray(candidate.education) &&
    candidate.education.every((item) => typeof item === "string")
  )
}

function extractStructuredOutputText(response: OpenAIResponsesOutputText) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim()
  }

  const textChunks = (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text ?? "")
    .join("")
    .trim()

  return textChunks || null
}

export function parseResumeText(text: string): ParsedResume {
  const normalizedText = text ?? ""
  const email = extractEmail(normalizedText)

  return {
    name: extractName(normalizedText, email),
    email,
    phone: extractPhone(normalizedText),
    skills: extractSkills(normalizedText),
    experienceYears: extractExperienceYears(normalizedText),
    education: extractEducation(normalizedText),
  }
}

export async function parseResumeWithAI(text: string): Promise<ParsedResume> {
  const fallback = parseResumeText(text)
  const apiKey = process.env.OPENAI_API_KEY
  const trimmedText = text?.trim()

  if (!apiKey || !trimmedText) {
    return fallback
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "Extract structured information from this resume text. Return only JSON matching the schema.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: trimmedText.slice(0, 12000),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "resume_parser",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
                email: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
                phone: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
                skills: {
                  type: "array",
                  items: { type: "string" },
                },
                experienceYears: {
                  anyOf: [{ type: "number" }, { type: "null" }],
                },
                education: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: [
                "name",
                "email",
                "phone",
                "skills",
                "experienceYears",
                "education",
              ],
            },
          },
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`)
    }

    const payload = (await response.json()) as OpenAIResponsesOutputText
    const outputText = extractStructuredOutputText(payload)

    if (!outputText) {
      throw new Error("OpenAI returned empty output")
    }

    const parsed = JSON.parse(outputText) as unknown

    if (!isParsedResume(parsed)) {
      throw new Error("OpenAI returned invalid resume JSON")
    }

    return {
      ...parsed,
      name: normalizeCandidateName(parsed.name) ?? normalizeCandidateName(fallback.name),
    }
  } catch (error) {
    console.error("Failed to parse resume with OpenAI", error)
    return fallback
  }
}
