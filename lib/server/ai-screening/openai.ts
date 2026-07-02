import { deriveSkillsFromText, sanitizeSkillList } from "@/lib/server/ai/skills"
import type { ParsedResume } from "@/lib/server/resumeParser"

export type ParsedJobDescription = {
  roleTitle: string | null
  requiredSkills: string[]
  experienceNeeded: number | null
  seniority: "JUNIOR" | "MID" | "SENIOR" | null
  summary: string
}

export type CandidateMatchResult = {
  matchScore: number
  skillMatch: number
  experienceMatch: number
  missingSkills: string[]
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  recommendation: "STRONG_FIT" | "POTENTIAL" | "WEAK" | "REJECT"
  shortReasoning: string
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

const DEFAULT_MODEL = "gpt-4o-mini"

function getOpenAIModel() {
  return process.env.OPENAI_SCREENING_MODEL?.trim() || DEFAULT_MODEL
}

function isAiCandidateMatchingEnabled() {
  return process.env.VERIS_SCREENING_AI_MATCHING === "true"
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

function clampScore(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value)

  if (!Number.isFinite(numberValue)) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round(numberValue)))
}

async function callOpenAIJson<T>(input: {
  system: string
  user: string
  schemaName: string
  schema: Record<string, unknown>
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim().replace(/^"|"$/g, "")

  if (!apiKey) {
    return null
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getOpenAIModel(),
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: input.system }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: input.user }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema,
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

  return JSON.parse(outputText) as T
}

function extractExperienceNeeded(text: string) {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+experience/i,
    /experience\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i,
    /minimum\s+(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const parsed = Number.parseFloat(match[1])
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

function inferSeniority(experienceNeeded: number | null): ParsedJobDescription["seniority"] {
  if (experienceNeeded === null) {
    return null
  }

  if (experienceNeeded <= 1.5) {
    return "JUNIOR"
  }

  if (experienceNeeded >= 6) {
    return "SENIOR"
  }

  return "MID"
}

function fallbackParseJobDescription(description: string, titleHint?: string | null): ParsedJobDescription {
  const trimmed = description.trim()
  const firstLine = trimmed.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  const experienceNeeded = extractExperienceNeeded(trimmed)
  const requiredSkills = sanitizeSkillList(deriveSkillsFromText(trimmed), {
    jobTitle: titleHint ?? firstLine ?? undefined,
    jobDescription: trimmed,
  }).slice(0, 24)

  return {
    roleTitle: titleHint?.trim() || firstLine?.replace(/^role\s*[:\-]\s*/i, "") || "Untitled Role",
    requiredSkills,
    experienceNeeded,
    seniority: inferSeniority(experienceNeeded),
    summary: trimmed.slice(0, 700),
  }
}

function normalizeParsedJobDescription(
  parsed: ParsedJobDescription,
  description: string,
  titleHint?: string | null
): ParsedJobDescription {
  const fallback = fallbackParseJobDescription(description, titleHint)
  const experienceNeeded =
    typeof parsed.experienceNeeded === "number" && Number.isFinite(parsed.experienceNeeded)
      ? parsed.experienceNeeded
      : fallback.experienceNeeded
  const requiredSkills = sanitizeSkillList(
    Array.isArray(parsed.requiredSkills) ? parsed.requiredSkills : fallback.requiredSkills,
    {
      jobTitle: parsed.roleTitle ?? titleHint ?? undefined,
      jobDescription: description,
    }
  ).slice(0, 30)

  return {
    roleTitle: parsed.roleTitle?.trim() || fallback.roleTitle,
    requiredSkills,
    experienceNeeded,
    seniority:
      parsed.seniority === "JUNIOR" || parsed.seniority === "MID" || parsed.seniority === "SENIOR"
        ? parsed.seniority
        : inferSeniority(experienceNeeded),
    summary: parsed.summary?.trim() || fallback.summary,
  }
}

export async function parseJobDescriptionWithAI(description: string, titleHint?: string | null) {
  const fallback = fallbackParseJobDescription(description, titleHint)
  const trimmedDescription = description.trim()

  if (!trimmedDescription || !process.env.OPENAI_API_KEY) {
    return fallback
  }

  try {
    const parsed = await callOpenAIJson<ParsedJobDescription>({
      schemaName: "job_description_parser",
      system:
        "Extract structured hiring requirements from a job description. Return only JSON matching the schema.",
      user: [
        "Extract these fields from the job description:",
        "- Required skills",
        "- Experience needed",
        "- Role title",
        "",
        `Title hint: ${titleHint || "N/A"}`,
        "",
        trimmedDescription.slice(0, 14000),
      ].join("\n"),
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          roleTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
          requiredSkills: { type: "array", items: { type: "string" } },
          experienceNeeded: { anyOf: [{ type: "number" }, { type: "null" }] },
          seniority: {
            anyOf: [
              { type: "string", enum: ["JUNIOR", "MID", "SENIOR"] },
              { type: "null" },
            ],
          },
          summary: { type: "string" },
        },
        required: ["roleTitle", "requiredSkills", "experienceNeeded", "seniority", "summary"],
      },
    })

    return normalizeParsedJobDescription(parsed ?? fallback, trimmedDescription, titleHint)
  } catch (error) {
    console.error("Failed to parse job description with OpenAI", error)
    return fallback
  }
}

function normalizeSkill(value: string) {
  return value.trim().toLowerCase()
}

function normalizeEvidenceText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function stringifyCandidateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map(stringifyCandidateValue).join(" ")
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(stringifyCandidateValue).join(" ")
  }

  return ""
}

function buildCandidateEvidence(input: {
  candidate: ParsedResume | Record<string, unknown>
  resumeText?: string | null
}) {
  return normalizeEvidenceText(
    [
      getCandidateSkills(input.candidate).join(" "),
      stringifyCandidateValue(input.candidate),
      input.resumeText ?? "",
    ].join(" ")
  )
}

const SKILL_STOPWORDS = new Set([
  "and",
  "or",
  "of",
  "in",
  "to",
  "for",
  "with",
  "on",
  "the",
  "a",
  "an",
  "good",
  "strong",
  "hands",
  "hand",
  "working",
  "knowledge",
  "understanding",
  "experience",
  "proficiency",
  "concepts",
  "core",
  "basic",
  "related",
  "services",
  "activities",
  "ability",
  "proven",
  "capability",
  "familiarity",
  "expertise",
  "skilled",
  "using",
  "including",
  "such",
  "as",
  "tools",
  "platform",
  "platforms",
  "systems",
  "environment",
  "environments",
  "management",
  "development",
  "developer",
  "engineering",
  "engineer",
  "administration",
  "administrator",
  "support",
  "operations",
  "operational",
])

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map(normalizeEvidenceText).filter(Boolean)))
}

const GLOBAL_SKILL_ALIAS_GROUPS = [
  ["javascript", "js", "ecmascript"],
  ["typescript", "ts"],
  ["node.js", "node js", "nodejs", "node"],
  ["react.js", "react js", "reactjs", "react"],
  ["next.js", "next js", "nextjs", "next"],
  ["vue.js", "vue js", "vuejs", "vue"],
  ["angular.js", "angular js", "angularjs", "angular"],
  ["express.js", "express js", "expressjs", "express"],
  ["nestjs", "nest js", "nest.js"],
  ["java", "j2ee", "jakarta ee"],
  ["spring boot", "springboot"],
  ["c#", "c sharp", "csharp"],
  [".net", "dotnet", "asp.net", "asp net"],
  ["c++", "cpp"],
  ["python", "py"],
  ["django", "django rest framework", "drf"],
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"],
  ["large language model", "large language models", "llm", "llms", "generative ai", "gen ai"],
  ["natural language processing", "nlp"],
  ["rest api", "restful api", "rest", "api development"],
  ["graphql", "graph ql"],
  ["microservices", "microservice architecture"],
  ["ci/cd", "ci cd", "continuous integration", "continuous delivery", "continuous deployment"],
  ["aws", "amazon web services"],
  ["gcp", "google cloud", "google cloud platform"],
  ["azure", "microsoft azure"],
  ["docker", "containerization", "containers"],
  ["kubernetes", "k8s"],
  ["terraform", "infrastructure as code", "iac"],
  ["linux", "unix"],
  ["postgresql", "postgres"],
  ["sql server", "mssql", "ms sql"],
  ["mongodb", "mongo db"],
  ["redis", "elasticache"],
  ["elasticsearch", "elastic search", "opensearch"],
  ["data pipeline", "data pipelines", "etl", "elt"],
  ["data warehouse", "data warehousing", "dwh"],
  ["power bi", "powerbi"],
  ["tableau", "tableau desktop"],
  ["quality assurance", "qa", "testing"],
  ["test automation", "automation testing", "automated testing"],
  ["selenium", "selenium webdriver"],
  ["playwright", "playwright testing"],
  ["cypress", "cypress testing"],
  ["security", "cybersecurity", "information security", "infosec"],
  ["identity and access management", "iam"],
  ["agile", "scrum"],
  ["jira", "atlassian jira"],
  ["product management", "product manager"],
  ["project management", "program management"],
  ["customer relationship management", "crm"],
  ["search engine optimization", "seo"],
  ["search engine marketing", "sem"],
  ["user experience", "ux"],
  ["user interface", "ui"],
]

const SERVICE_COORDINATION_ALIAS_GROUPS = [
  [
    "service operations management",
    "service operations",
    "service coordination",
    "service administration",
    "service administrator",
    "service max operations",
    "servicemax operations",
    "open calls",
    "ttr reporting",
    "service camps",
    "customer complaints",
    "preventive maintenance",
  ],
  [
    "invoice management",
    "invoice",
    "invoicing",
    "invoiced",
    "billing",
    "service contract invoicing",
    "erp invoicing",
  ],
  [
    "billing",
    "invoice",
    "invoicing",
    "renewal billing",
    "contract billing",
    "service contract invoicing",
  ],
  [
    "engineer support",
    "service engineer support",
    "service engineers",
    "engineers",
    "coordinating with engineers",
    "support engineers",
    "fsr",
    "fsrs",
    "delivery challans",
    "service trainings of engineers",
  ],
  [
    "warranty management",
    "warranty",
    "warranty claims",
    "contract type",
    "service contracts",
    "service contract",
    "contract renewals",
    "renewal management",
  ],
  [
    "spare parts logistics coordination",
    "spare parts",
    "parts logistics",
    "parts availability",
    "parts coordination",
    "supply of parts",
    "planning of parts",
    "parts utilized",
    "inventory management",
    "rop",
    "warehouse",
    "dispatch",
  ],
  [
    "reporting mis",
    "mis reporting",
    "mis reports",
    "reports",
    "ppt",
    "presentations",
    "daily reports",
    "weekly reports",
    "monthly reports",
  ],
]

const CROSS_INDUSTRY_ALIAS_GROUPS = [
  [
    "software development",
    "application development",
    "programming",
    "coding",
    "web development",
    "full stack development",
    "backend development",
    "frontend development",
  ],
  [
    "it support",
    "technical support",
    "desktop support",
    "helpdesk",
    "help desk",
    "troubleshooting",
    "ticket handling",
    "incident management",
  ],
  [
    "network administration",
    "networking",
    "lan",
    "wan",
    "router",
    "switch",
    "firewall",
    "vpn",
  ],
  [
    "medical industry",
    "healthcare",
    "hospital",
    "clinical",
    "patient coordination",
    "patient care",
    "medical equipment",
    "diagnostics",
    "laboratory",
    "pharma",
  ],
  [
    "banking operations",
    "banking",
    "financial services",
    "branch operations",
    "loan processing",
    "credit evaluation",
    "kyc",
    "aml",
    "account opening",
    "cash handling",
  ],
  [
    "corporate administration",
    "administration",
    "office administration",
    "admin operations",
    "back office",
    "documentation",
    "records management",
    "data entry",
    "filing",
  ],
  [
    "front office",
    "front desk",
    "reception",
    "receptionist",
    "visitor management",
    "call handling",
    "appointment scheduling",
    "guest handling",
  ],
  [
    "executive assistant",
    "personal assistant",
    "ea",
    "pa",
    "calendar management",
    "travel coordination",
    "meeting coordination",
    "minutes of meeting",
  ],
  [
    "human resources",
    "hr",
    "recruitment",
    "talent acquisition",
    "candidate screening",
    "interview coordination",
    "onboarding",
    "employee engagement",
    "payroll",
  ],
  [
    "sales",
    "business development",
    "lead generation",
    "client acquisition",
    "field sales",
    "inside sales",
    "channel sales",
    "crm",
    "pipeline management",
  ],
  [
    "customer service",
    "customer support",
    "customer care",
    "client servicing",
    "query resolution",
    "complaint handling",
    "escalation handling",
    "call center",
    "bpo",
  ],
  [
    "accounting",
    "finance",
    "accounts payable",
    "accounts receivable",
    "bookkeeping",
    "gst",
    "taxation",
    "tally",
    "reconciliation",
  ],
  [
    "procurement",
    "purchase",
    "purchasing",
    "vendor management",
    "supplier management",
    "purchase order",
    "po",
    "quotation",
    "negotiation",
  ],
  [
    "logistics",
    "warehouse",
    "dispatch",
    "inventory",
    "stock management",
    "delivery coordination",
    "shipment tracking",
    "supply chain",
  ],
  [
    "manufacturing",
    "production",
    "quality control",
    "quality assurance",
    "maintenance",
    "process improvement",
    "safety compliance",
    "lean",
  ],
  [
    "marketing",
    "digital marketing",
    "campaign management",
    "social media",
    "seo",
    "sem",
    "content marketing",
    "brand management",
  ],
  [
    "teaching",
    "education",
    "training",
    "trainer",
    "faculty",
    "curriculum",
    "student coordination",
    "learning and development",
  ],
]

function stemEvidenceToken(token: string) {
  if (token.length <= 4) {
    return token
  }

  if (/invoic(?:e|ing|ed|es)$/i.test(token)) {
    return "invoice"
  }

  return token
    .replace(/(?:ization|isation)$/i, "ize")
    .replace(/(?:tion|sion)$/i, "t")
    .replace(/(?:ing|ers|er|ed|es|s)$/i, "")
}

function expandSkillPhrase(skill: string) {
  const normalized = normalizeEvidenceText(skill)
  const variants = [normalized]
  const compact = normalized.replace(/\s+/g, "")

  if (compact && compact !== normalized) {
    variants.push(compact)
  }

  for (const part of normalized.split(/\b(?:and|or|with)\b|[,+]/i)) {
    if (part.trim()) {
      variants.push(part)
    }
  }

  const slashParts = skill
    .split(/[\/|]/)
    .map((part) => normalizeEvidenceText(part))
    .filter(Boolean)
  variants.push(...slashParts)

  return uniqueValues(variants)
}

function getSkillAliases(skill: string) {
  const normalized = normalizeEvidenceText(skill)
  const aliases: string[] = expandSkillPhrase(skill)

  const add = (...items: string[]) => aliases.push(...items)

  for (const group of GLOBAL_SKILL_ALIAS_GROUPS) {
    if (group.some((alias) => normalized.includes(normalizeEvidenceText(alias)))) {
      add(...group)
    }
  }

  for (const group of SERVICE_COORDINATION_ALIAS_GROUPS) {
    if (group.some((alias) => normalized.includes(normalizeEvidenceText(alias)))) {
      add(...group)
    }
  }

  for (const group of CROSS_INDUSTRY_ALIAS_GROUPS) {
    if (group.some((alias) => normalized.includes(normalizeEvidenceText(alias)))) {
      add(...group)
    }
  }

  if (/\b(postgresql|postgres)\b/.test(normalized)) add("postgresql", "postgres")
  if (/\b(sql server|mssql|ms sql)\b/.test(normalized)) add("sql server", "mssql", "ms sql")
  if (/\bazure\b/.test(normalized)) add("azure", "azure sql", "azure database", "azure database for postgresql")
  if (/\boracle\b/.test(normalized)) add("oracle")
  if (/\bmysql\b/.test(normalized)) add("mysql")
  if (/\bbackup|restore|recovery\b/.test(normalized)) add("backup", "restore", "disaster recovery", "recovery")
  if (/\bpatch|patching\b/.test(normalized)) add("patch", "patching", "patched")
  if (/\bmonitor|monitoring\b/.test(normalized)) add("monitor", "monitoring", "monitored")
  if (/\blog|logs|diagnostic\b/.test(normalized)) add("log analysis", "logs", "diagnostic")
  if (/\bperformance|tuning|optimization|execution plan|indexing\b/.test(normalized)) {
    add("performance tuning", "sql performance tuning", "optimization", "execution plan", "indexing", "index")
  }
  if (/\bsecurity|audit\b/.test(normalized)) add("security", "audit", "encryption", "privileges", "roles")
  if (/\bmigration|modernization|cloud transformation\b/.test(normalized)) add("migration", "data migration", "modernization")
  if (/\bautomation|script|powershell|runbook\b/.test(normalized)) add("automation", "scripts", "powershell", "runbook")
  if (/\bdocumentation|procedure|report|cmdb\b/.test(normalized)) {
    add("documentation", "user manuals", "standard operating procedures", "reports")
  }
  if (/\bservice\b/.test(normalized) && /\b(operation|coordination|administration|management)\b/.test(normalized)) {
    add("service operations", "service coordination", "service administration", "service administrator", "service max operations")
  }
  if (/\binvoice|invoicing|billing\b/.test(normalized)) {
    add("invoice", "invoicing", "billing", "erp invoicing", "service contract invoicing")
  }
  if (/\bengineer\b/.test(normalized) && /\b(support|coordination|management)\b/.test(normalized)) {
    add("service engineers", "coordinating with engineers", "support engineers", "engineer coordination")
  }
  if (/\bwarranty|contract renewal|service contract\b/.test(normalized)) {
    add("warranty", "service contracts", "contract type", "contract renewals", "renewal management")
  }
  if (/\bspare|parts|logistics|warehouse|inventory\b/.test(normalized)) {
    add("spare parts", "parts availability", "supply of parts", "planning of parts", "inventory management", "dispatch")
  }
  if (/\bdatabase administration|database administrator|dba|database operations\b/.test(normalized)) {
    add("database administrator", "database administration", "database management", "database operations", "dba")
  }

  return uniqueValues(aliases)
}

function getImportantSkillTokens(skill: string) {
  return expandSkillPhrase(skill)
    .join(" ")
    .split(" ")
    .filter((token) => token.length >= 3 && !SKILL_STOPWORDS.has(token))
}

function scoreSkillEvidence(skill: string, evidence: string) {
  const aliases = getSkillAliases(skill)

  if (aliases.some((alias) => evidence.includes(alias) || evidence.includes(alias.replace(/\s+/g, "")))) {
    return 1
  }

  const tokens = getImportantSkillTokens(skill)
  if (tokens.length === 0) {
    return 0
  }

  const evidenceTokens = new Set(evidence.split(" ").filter(Boolean))
  const evidenceStems = new Set(Array.from(evidenceTokens).map(stemEvidenceToken))
  const matchedTokens = tokens.filter((token) => {
    const stemmed = stemEvidenceToken(token)
    return evidence.includes(token) || evidenceTokens.has(token) || evidenceStems.has(stemmed)
  }).length
  const coverage = matchedTokens / tokens.length

  if (tokens.length <= 2) {
    return coverage === 1 ? 0.9 : 0
  }

  return coverage >= 0.7 ? 0.75 : coverage >= 0.5 ? 0.55 : 0
}

function inferExperienceYearsFromEvidence(evidence: string) {
  const explicitMatch = evidence.match(/(\d+(?:\.\d+)?)\s*\+?\s*years?/)
  if (explicitMatch?.[1]) {
    const explicitYears = Number.parseFloat(explicitMatch[1])
    if (Number.isFinite(explicitYears)) {
      return explicitYears
    }
  }

  const ranges = evidence.matchAll(/\b(\d{1,2})\/(\d{4})\s*-\s*(current|present|(\d{1,2})\/(\d{4}))/gi)
  let months = 0
  const now = new Date()

  for (const range of ranges) {
    const startMonth = Number(range[1])
    const startYear = Number(range[2])
    const endMonth = range[3] === "current" || range[3] === "present" ? now.getMonth() + 1 : Number(range[4])
    const endYear = range[3] === "current" || range[3] === "present" ? now.getFullYear() : Number(range[5])

    if (
      Number.isFinite(startMonth) &&
      Number.isFinite(startYear) &&
      Number.isFinite(endMonth) &&
      Number.isFinite(endYear)
    ) {
      months += Math.max(0, (endYear - startYear) * 12 + (endMonth - startMonth))
    }
  }

  return months > 0 ? Math.round((months / 12) * 10) / 10 : null
}

function getCandidateSkills(candidate: ParsedResume | Record<string, unknown>) {
  const skills = Array.isArray(candidate.skills) ? candidate.skills : []
  return skills.filter((skill): skill is string => typeof skill === "string" && Boolean(skill.trim()))
}

function getCandidateExperience(candidate: ParsedResume | Record<string, unknown>) {
  const experienceYears =
    "experienceYears" in candidate ? candidate.experienceYears : (candidate as Record<string, unknown>).experience_years

  if (typeof experienceYears === "number" && Number.isFinite(experienceYears)) {
    return experienceYears
  }

  return null
}

function fallbackMatchCandidate(input: {
  candidate: ParsedResume | Record<string, unknown>
  job: ParsedJobDescription
  resumeText?: string | null
}): CandidateMatchResult {
  const requiredSkills = input.job.requiredSkills.filter(Boolean)
  const evidence = buildCandidateEvidence({ candidate: input.candidate, resumeText: input.resumeText })
  const scoredSkills = requiredSkills.map((skill) => ({
    skill,
    score: scoreSkillEvidence(skill, evidence),
  }))
  const matchedSkillCount = scoredSkills.filter((item) => item.score >= 0.55).length
  const skillMatch =
    requiredSkills.length > 0
      ? clampScore((scoredSkills.reduce((total, item) => total + item.score, 0) / requiredSkills.length) * 100)
      : 50
  const candidateExperience = getCandidateExperience(input.candidate) ?? inferExperienceYearsFromEvidence(evidence)
  const experienceNeeded = input.job.experienceNeeded
  const experienceMatch =
    candidateExperience === null || experienceNeeded === null
      ? 55
      : clampScore((candidateExperience / Math.max(experienceNeeded, 1)) * 100)
  const matchScore = clampScore(skillMatch * 0.72 + experienceMatch * 0.28)
  const missingSkills = scoredSkills.filter((item) => item.score < 0.55).map((item) => item.skill).slice(0, 12)
  const riskLevel = matchScore >= 75 ? "LOW" : matchScore >= 50 ? "MEDIUM" : "HIGH"
  const recommendation =
    matchScore >= 82 ? "STRONG_FIT" : matchScore >= 62 ? "POTENTIAL" : matchScore >= 42 ? "WEAK" : "REJECT"

  return {
    matchScore,
    skillMatch,
    experienceMatch,
    missingSkills,
    riskLevel,
    recommendation,
    shortReasoning:
      missingSkills.length > 0
        ? `Candidate covers ${matchedSkillCount}/${requiredSkills.length || 0} required skills; gaps include ${missingSkills.slice(0, 4).join(", ")}.`
        : "Candidate skills and experience align with the job requirements.",
  }
}

function normalizeMatchResult(result: CandidateMatchResult, fallback: CandidateMatchResult): CandidateMatchResult {
  const riskLevel =
    result.riskLevel === "LOW" || result.riskLevel === "MEDIUM" || result.riskLevel === "HIGH"
      ? result.riskLevel
      : fallback.riskLevel
  const recommendation =
    result.recommendation === "STRONG_FIT" ||
    result.recommendation === "POTENTIAL" ||
    result.recommendation === "WEAK" ||
    result.recommendation === "REJECT"
      ? result.recommendation
      : fallback.recommendation

  return {
    matchScore: clampScore(result.matchScore),
    skillMatch: clampScore(result.skillMatch),
    experienceMatch: clampScore(result.experienceMatch),
    missingSkills: Array.isArray(result.missingSkills)
      ? result.missingSkills.filter((skill): skill is string => typeof skill === "string").slice(0, 20)
      : fallback.missingSkills,
    riskLevel,
    recommendation,
    shortReasoning: result.shortReasoning?.trim() || fallback.shortReasoning,
  }
}

export async function matchCandidateToJobWithAI(input: {
  candidateJson: ParsedResume | Record<string, unknown>
  resumeText?: string | null
  job: ParsedJobDescription & {
    title: string
    description: string
  }
}) {
  const fallback = fallbackMatchCandidate({
    candidate: input.candidateJson,
    job: input.job,
    resumeText: input.resumeText,
  })

  if (!isAiCandidateMatchingEnabled() || !process.env.OPENAI_API_KEY) {
    return fallback
  }

  try {
    const parsed = await callOpenAIJson<CandidateMatchResult>({
      schemaName: "candidate_job_match",
      system:
        "Compare the candidate resume with the job description. Score conservatively and return only JSON matching the schema.",
      user: [
        "Compare this resume with this job description.",
        "",
        "Return:",
        "- match_score (0-100)",
        "- skill_match (0-100)",
        "- experience_match (0-100)",
        "- missing_skills",
        "- risk_level (LOW/MEDIUM/HIGH)",
        "- recommendation (STRONG_FIT, POTENTIAL, WEAK, REJECT)",
        "- short reasoning",
        "",
        `Job title: ${input.job.title}`,
        `Job required skills: ${input.job.requiredSkills.join(", ") || "N/A"}`,
        `Experience needed: ${input.job.experienceNeeded ?? "N/A"}`,
        "",
        "Job description:",
        input.job.description.slice(0, 10000),
        "",
        "Candidate structured data:",
        JSON.stringify(input.candidateJson).slice(0, 7000),
        "",
        "Resume text:",
        (input.resumeText ?? "").slice(0, 8000),
      ].join("\n"),
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          matchScore: { type: "integer", minimum: 0, maximum: 100 },
          skillMatch: { type: "integer", minimum: 0, maximum: 100 },
          experienceMatch: { type: "integer", minimum: 0, maximum: 100 },
          missingSkills: { type: "array", items: { type: "string" } },
          riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
          recommendation: {
            type: "string",
            enum: ["STRONG_FIT", "POTENTIAL", "WEAK", "REJECT"],
          },
          shortReasoning: { type: "string" },
        },
        required: [
          "matchScore",
          "skillMatch",
          "experienceMatch",
          "missingSkills",
          "riskLevel",
          "recommendation",
          "shortReasoning",
        ],
      },
    })

    return normalizeMatchResult(parsed ?? fallback, fallback)
  } catch (error) {
    console.error("Failed to match candidate with OpenAI", error)
    return fallback
  }
}
