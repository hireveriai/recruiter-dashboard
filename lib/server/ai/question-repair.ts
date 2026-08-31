import { openAiFetch } from "@/lib/server/ai-usage-log"
import { inferRoleIntelligence, normalizeSkillName, presentSkillName, type RoleFamily } from "@/lib/server/ai/skills"

export type RepairQuestionInput = {
  question_text: string
  intent?: string
  skill?: string
}

export type RepairQuestionOutput = {
  original: string
  repaired: string | null
  changed: boolean
  rejected?: boolean
  reason?: string
}

const STRONG_STARTERS = [
  "How do you",
  "How would you",
  "What would you do if",
]

const BROKEN_PHRASES = [
  "cannot be compromised",
  "still matters",
  "starts affecting outcomes",
  "is central to the outcome",
  "is a key part of the work",
  "at first",
  "cannot be ignored",
]

const NORMALIZATION_RULES: Array<[RegExp, string]> = [
  [/[Ã‚Â·Ã¢â‚¬Â¢_]+/g, " "],
  [/\bwhen there is incomplete information\b/gi, "when data is incomplete"],
  [/\bexecute database\b/gi, "manage databases"],
  [/\bexecute sql\b/gi, "work with SQL"],
  [/\bthings\b/gi, "the workflow"],
  [/\bstuff\b/gi, "the workflow"],
  [/\boutcomes\b/gi, "results"],
  [/\s{2,}/g, " "],
]

const DOMAIN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Azure Data Factory", pattern: /\bazure data factory\b|\badf\b/i },
  { label: "Databricks", pattern: /\bdatabricks\b/i },
  { label: "Spark", pattern: /\bspark\b/i },
  { label: "ETL pipelines", pattern: /\betl\b|\bpipeline(s)?\b/i },
  { label: "SQL", pattern: /\bsql\b/i },
  { label: "MySQL", pattern: /\bmysql\b/i },
  { label: "PostgreSQL", pattern: /\bpostgres(ql)?\b/i },
  { label: "Data Lake", pattern: /\bdata lake\b/i },
  { label: "Airflow", pattern: /\bairflow\b/i },
  { label: "dbt", pattern: /\bdbt\b/i },
  { label: "Kafka", pattern: /\bkafka\b/i },
  { label: "monitoring", pattern: /\bmonitoring\b|\balert(s)?\b/i },
  { label: "incident response", pattern: /\bincident\b|\boutage\b|\bfailure\b/i },
  { label: "performance optimization", pattern: /\bperformance\b|\blatency\b|\bslow\b/i },
  { label: "database security", pattern: /\bsecurity\b|\bencryption\b|\baccess control\b/i },
  { label: "database maintenance", pattern: /\bmaintenance\b|\bbackup\b|\breplication\b/i },
  { label: "SLA management", pattern: /\bsla\b|\bservice level\b/i },
  { label: "scheduling", pattern: /\bscheduling\b|\bschedule\b/i },
  { label: "dispatch", pattern: /\bdispatch\b/i },
  { label: "resource allocation", pattern: /\bresource allocation\b|\ballocation\b/i },
  { label: "sales pipeline", pattern: /\bsales pipeline\b|\bpipeline management\b/i },
  { label: "prospecting", pattern: /\bprospecting\b|\blead generation\b/i },
  { label: "negotiation", pattern: /\bnegotiation\b/i },
  { label: "account management", pattern: /\baccount management\b/i },
  { label: "CRM", pattern: /\bcrm\b/i },
  { label: "talent acquisition", pattern: /\btalent acquisition\b|\brecruitment\b|\bhiring\b/i },
  { label: "candidate screening", pattern: /\bscreening\b|\bcandidate screening\b/i },
  { label: "employee relations", pattern: /\bemployee relations\b/i },
  { label: "payroll", pattern: /\bpayroll\b/i },
  { label: "financial reporting", pattern: /\bfinancial reporting\b|\baccounting\b/i },
  { label: "budgeting", pattern: /\bbudgeting\b|\bbudget\b/i },
  { label: "forecasting", pattern: /\bforecasting\b|\bforecast\b/i },
  { label: "procurement", pattern: /\bprocurement\b|\bpurchasing\b/i },
  { label: "vendor management", pattern: /\bvendor management\b|\bvendor\b|\bsupplier\b/i },
  { label: "inventory management", pattern: /\binventory\b/i },
  { label: "campaign management", pattern: /\bcampaign\b|\bdemand generation\b/i },
  { label: "SEO", pattern: /\bseo\b/i },
  { label: "content strategy", pattern: /\bcontent\b|\bcontent marketing\b/i },
  { label: "compliance", pattern: /\bcompliance\b|\bpolicy\b|\bregulatory\b/i },
  { label: "contract review", pattern: /\bcontract\b/i },
  { label: "patient care", pattern: /\bpatient\b|\bclinical\b|\bcare\b/i },
  { label: "training delivery", pattern: /\btraining\b|\beducation\b|\bcurriculum\b/i },
  { label: "warehouse operations", pattern: /\bwarehouse\b/i },
  { label: "fleet operations", pattern: /\bfleet\b/i },
  { label: "logistics", pattern: /\blogistics\b|\bshipping\b/i },
  { label: "design workflow", pattern: /\bdesign\b|\bux\b|\bui\b/i },
  { label: "content production", pattern: /\bcopywriting\b|\bcontent production\b/i },
  { label: "call handling", pattern: /\bcall center\b|\bcall handling\b/i },
  { label: "customer support", pattern: /\bcustomer support\b|\bticket\b/i },
  { label: "banking operations", pattern: /\bbanking\b|\bloan\b|\bcredit\b/i },
  { label: "risk assessment", pattern: /\brisk assessment\b|\bfraud\b/i },
  { label: "stakeholder management", pattern: /\bstakeholder\b/i },
  { label: "team leadership", pattern: /\bleadership\b|\bteam management\b/i },
]

const DOMAIN_CONTEXT_BY_FAMILY: Record<RoleFamily, {
  defaultSystem: string
  defaultProblem: string
  problemPatterns: Array<{ pattern: RegExp; value: string }>
  constraintPatterns: Array<{ pattern: RegExp; value: string }>
}> = {
  technical: {
    defaultSystem: "the system",
    defaultProblem: "a production issue",
    problemPatterns: [
      { pattern: /\bincident\b|\boutage\b|\bfail|\bbreak/i, value: "a recurring incident" },
      { pattern: /\blatency\b|\bslow\b|\bperformance\b/i, value: "performance issues" },
      { pattern: /\bsecurity\b|\brisk\b|\baccess\b/i, value: "a security risk" },
      { pattern: /\bmonitoring\b|\balert\b|\bsignal\b/i, value: "warning signals" },
    ],
    constraintPatterns: [
      { pattern: /\bhigh volume\b|\bscale\b/i, value: "at scale" },
      { pattern: /\bincomplete\b|\bmissing\b|\bunclear\b/i, value: "when data is incomplete" },
      { pattern: /\bunder pressure\b|\burgent\b/i, value: "under time pressure" },
    ],
  },
  operations: {
    defaultSystem: "the operation",
    defaultProblem: "a service disruption",
    problemPatterns: [
      { pattern: /\bschedule\b|\bdispatch\b|\bresource\b/i, value: "a scheduling conflict" },
      { pattern: /\bsla\b|\bservice level\b/i, value: "an SLA risk" },
      { pattern: /\bparts\b|\bsupply chain\b/i, value: "a parts shortage" },
    ],
    constraintPatterns: [
      { pattern: /\bunder pressure\b|\burgent\b|\btime window\b/i, value: "under time pressure" },
      { pattern: /\bincomplete\b|\bmissing\b/i, value: "with incomplete information" },
    ],
  },
  sales: {
    defaultSystem: "the sales process",
    defaultProblem: "a stalled deal",
    problemPatterns: [
      { pattern: /\bobjection\b|\bhesitat/i, value: "a customer objection" },
      { pattern: /\bpipeline\b|\bforecast\b/i, value: "pipeline risk" },
      { pattern: /\brenewal\b|\bretention\b/i, value: "a retention risk" },
    ],
    constraintPatterns: [
      { pattern: /\bquota\b|\btarget\b/i, value: "under quota pressure" },
      { pattern: /\bincomplete\b|\bunclear\b/i, value: "with limited information" },
    ],
  },
  customer_success: {
    defaultSystem: "the customer workflow",
    defaultProblem: "a customer escalation",
    problemPatterns: [
      { pattern: /\bescalation\b/i, value: "a customer escalation" },
      { pattern: /\brenewal\b|\bretention\b/i, value: "a retention risk" },
      { pattern: /\bonboarding\b/i, value: "an onboarding gap" },
    ],
    constraintPatterns: [
      { pattern: /\burgent\b|\bpressure\b/i, value: "under customer pressure" },
      { pattern: /\bincomplete\b/i, value: "with incomplete context" },
    ],
  },
  hr: {
    defaultSystem: "the hiring process",
    defaultProblem: "a hiring challenge",
    problemPatterns: [
      { pattern: /\bsourcing\b|\bcandidate\b/i, value: "a sourcing bottleneck" },
      { pattern: /\bpayroll\b/i, value: "a payroll issue" },
      { pattern: /\bemployee relations\b/i, value: "an employee relations issue" },
    ],
    constraintPatterns: [
      { pattern: /\btime pressure\b|\burgent\b/i, value: "under time pressure" },
      { pattern: /\bincomplete\b/i, value: "with incomplete information" },
    ],
  },
  finance: {
    defaultSystem: "the finance workflow",
    defaultProblem: "a reporting issue",
    problemPatterns: [
      { pattern: /\bforecast\b|\bbudget\b/i, value: "a forecasting gap" },
      { pattern: /\breconciliation\b|\baccounting\b/i, value: "a reconciliation issue" },
      { pattern: /\bcollections\b|\binvoice\b/i, value: "a cash-flow risk" },
    ],
    constraintPatterns: [
      { pattern: /\bmonth end\b|\bquarter end\b/i, value: "during a tight close cycle" },
      { pattern: /\bincomplete\b/i, value: "with incomplete data" },
    ],
  },
  procurement: {
    defaultSystem: "the procurement workflow",
    defaultProblem: "a supply risk",
    problemPatterns: [
      { pattern: /\bvendor\b|\bsupplier\b/i, value: "a supplier issue" },
      { pattern: /\binventory\b/i, value: "an inventory gap" },
      { pattern: /\bpurchase order\b/i, value: "a purchase order delay" },
    ],
    constraintPatterns: [
      { pattern: /\burgent\b|\bpressure\b/i, value: "under delivery pressure" },
      { pattern: /\bincomplete\b/i, value: "with incomplete information" },
    ],
  },
  marketing: {
    defaultSystem: "the campaign workflow",
    defaultProblem: "a campaign issue",
    problemPatterns: [
      { pattern: /\bseo\b|\bsem\b/i, value: "a traffic drop" },
      { pattern: /\bcampaign\b|\bdemand generation\b/i, value: "an underperforming campaign" },
      { pattern: /\bbrand\b|\bcontent\b/i, value: "a messaging issue" },
    ],
    constraintPatterns: [
      { pattern: /\bdeadline\b|\blaunch\b/i, value: "against a launch deadline" },
      { pattern: /\bincomplete\b/i, value: "with incomplete performance data" },
    ],
  },
  manufacturing_industrial: {
    defaultSystem: "the production process",
    defaultProblem: "a production disruption",
    problemPatterns: [
      { pattern: /\bquality\b/i, value: "a quality issue" },
      { pattern: /\bmaintenance\b/i, value: "a maintenance problem" },
      { pattern: /\bthroughput\b|\bcapacity\b/i, value: "a throughput constraint" },
    ],
    constraintPatterns: [
      { pattern: /\bshift\b|\bdeadline\b/i, value: "during a tight production window" },
      { pattern: /\bincomplete\b/i, value: "with incomplete process data" },
    ],
  },
  construction_site: {
    defaultSystem: "the site workflow",
    defaultProblem: "a site issue",
    problemPatterns: [
      { pattern: /\bsafety\b/i, value: "a safety risk" },
      { pattern: /\bschedule\b|\bdelay\b/i, value: "a site delay" },
      { pattern: /\bcontractor\b/i, value: "a contractor coordination issue" },
    ],
    constraintPatterns: [
      { pattern: /\bweather\b/i, value: "under changing site conditions" },
      { pattern: /\bincomplete\b/i, value: "with incomplete site information" },
    ],
  },
  legal_compliance: {
    defaultSystem: "the compliance process",
    defaultProblem: "a compliance risk",
    problemPatterns: [
      { pattern: /\bcontract\b/i, value: "a contract risk" },
      { pattern: /\bpolicy\b|\bregulatory\b/i, value: "a regulatory issue" },
      { pattern: /\baudit\b/i, value: "an audit concern" },
    ],
    constraintPatterns: [
      { pattern: /\bincomplete\b/i, value: "with incomplete documentation" },
      { pattern: /\bdeadline\b/i, value: "under a reporting deadline" },
    ],
  },
  healthcare: {
    defaultSystem: "the care workflow",
    defaultProblem: "a patient care issue",
    problemPatterns: [
      { pattern: /\bpatient\b|\bclinical\b/i, value: "a patient care issue" },
      { pattern: /\bcompliance\b/i, value: "a compliance concern" },
      { pattern: /\bscheduling\b/i, value: "a scheduling disruption" },
    ],
    constraintPatterns: [
      { pattern: /\burgent\b|\bcritical\b/i, value: "under urgent conditions" },
      { pattern: /\bincomplete\b/i, value: "with incomplete clinical information" },
    ],
  },
  education_training: {
    defaultSystem: "the training process",
    defaultProblem: "a learning gap",
    problemPatterns: [
      { pattern: /\bcurriculum\b/i, value: "a curriculum issue" },
      { pattern: /\btraining\b/i, value: "a training gap" },
      { pattern: /\bengagement\b/i, value: "low learner engagement" },
    ],
    constraintPatterns: [
      { pattern: /\bdeadline\b/i, value: "under a delivery deadline" },
      { pattern: /\bincomplete\b/i, value: "with incomplete learner data" },
    ],
  },
  logistics_warehouse_fleet: {
    defaultSystem: "the logistics workflow",
    defaultProblem: "a logistics issue",
    problemPatterns: [
      { pattern: /\bwarehouse\b/i, value: "a warehouse bottleneck" },
      { pattern: /\bfleet\b/i, value: "a fleet disruption" },
      { pattern: /\bshipping\b|\bdelivery\b/i, value: "a delivery risk" },
    ],
    constraintPatterns: [
      { pattern: /\burgent\b|\btime window\b/i, value: "under a tight delivery window" },
      { pattern: /\bincomplete\b/i, value: "with incomplete shipment information" },
    ],
  },
  creative_design_content: {
    defaultSystem: "the creative workflow",
    defaultProblem: "a creative challenge",
    problemPatterns: [
      { pattern: /\bdesign\b|\bux\b|\bui\b/i, value: "a design issue" },
      { pattern: /\bcontent\b|\bcopy\b/i, value: "a content quality issue" },
      { pattern: /\bbrand\b/i, value: "a brand consistency issue" },
    ],
    constraintPatterns: [
      { pattern: /\bdeadline\b|\blaunch\b/i, value: "against a launch deadline" },
      { pattern: /\bfeedback\b/i, value: "with conflicting feedback" },
    ],
  },
  bpo_call_center: {
    defaultSystem: "the support workflow",
    defaultProblem: "a call handling issue",
    problemPatterns: [
      { pattern: /\bcall\b|\bticket\b/i, value: "a call handling issue" },
      { pattern: /\bescalation\b/i, value: "an escalation risk" },
      { pattern: /\bquality\b/i, value: "a service quality issue" },
    ],
    constraintPatterns: [
      { pattern: /\bvolume\b/i, value: "under high call volume" },
      { pattern: /\bincomplete\b/i, value: "with incomplete customer information" },
    ],
  },
  banking_financial_services: {
    defaultSystem: "the banking workflow",
    defaultProblem: "a financial risk",
    problemPatterns: [
      { pattern: /\bloan\b|\bcredit\b/i, value: "a credit risk" },
      { pattern: /\bfraud\b|\brisk\b/i, value: "a fraud risk" },
      { pattern: /\bcompliance\b/i, value: "a compliance issue" },
    ],
    constraintPatterns: [
      { pattern: /\bincomplete\b/i, value: "with incomplete financial information" },
      { pattern: /\bdeadline\b/i, value: "under a regulatory deadline" },
    ],
  },
  leadership_management: {
    defaultSystem: "the team workflow",
    defaultProblem: "a leadership challenge",
    problemPatterns: [
      { pattern: /\bstakeholder\b/i, value: "a stakeholder conflict" },
      { pattern: /\bteam\b|\bleadership\b/i, value: "a team performance issue" },
      { pattern: /\bstrategy\b/i, value: "a strategic trade-off" },
    ],
    constraintPatterns: [
      { pattern: /\bincomplete\b/i, value: "with incomplete information" },
      { pattern: /\bpressure\b/i, value: "under business pressure" },
    ],
  },
  general_business: {
    defaultSystem: "the workflow",
    defaultProblem: "an operational issue",
    problemPatterns: [
      { pattern: /\bpriority\b|\bcompeting\b/i, value: "competing priorities" },
      { pattern: /\bcoordination\b|\bstakeholder\b/i, value: "a coordination issue" },
    ],
    constraintPatterns: [
      { pattern: /\bincomplete\b/i, value: "with incomplete information" },
      { pattern: /\bpressure\b/i, value: "under pressure" },
    ],
  },
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function cleanRawText(value: string) {
  let next = value ?? ""
  for (const [pattern, replacement] of NORMALIZATION_RULES) {
    next = next.replace(pattern, replacement)
  }
  for (const phrase of BROKEN_PHRASES) {
    next = next.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
  }
  return normalizeWhitespace(next)
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length
}

function sentenceCase(value: string) {
  if (!value) {
    return value
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function looksMeaningless(text: string) {
  const normalized = text.toLowerCase()
  if (!normalized || wordCount(normalized) < 4) {
    return true
  }

  const badSignals = [
    /employee of the month/i,
    /worked as/i,
    /from .* to/i,
    /\baug\b|\bfeb\b|\bmar\b|\bapr\b|\bmay\b|\bjun\b|\bjul\b|\bsep\b|\boct\b|\bnov\b|\bdec\b/i,
  ]

  const signalHits = badSignals.filter((pattern) => pattern.test(text)).length
  return signalHits >= 2
}

export async function repairQuestionTextAI(input: RepairQuestionInput): Promise<RepairQuestionOutput> {
  const original = input.question_text ?? ""
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim().replace(/^"|"$/g, "")
  const model = process.env.OPENAI_QUESTION_MODEL || "gpt-4o-mini"

  if (!apiKey || !original) {
    return { original, repaired: original, changed: false }
  }

  const prompt = `
You are a strict editor.

Rewrite the question into a clean, short, professional interview question.

---

RULES:

1. REMOVE:
   - any JD descriptions
   - any resume sentences
   - prefixes like:
     "You highlighted"
     "Your background includes"
     "When working on"
     "Think of a time"

2. KEEP ONLY:
   - ONE idea
   - ONE skill

3. SHORTEN:
   - max 14 words

4. CONVERT INTO:
   - How do you...
   - How would you...
   - What would you do if...
   - Walk me through...

5. REMOVE:
   - comma-separated lists
   - long explanations

6. IF INPUT IS BAD:
   → rewrite into a valid technical question

---

OUTPUT:
Return ONLY the final cleaned question.

INPUT:
question: "${original}"
`

  try {
    const response = await openAiFetch("https://api.openai.com/v1/responses", {
      aiUsage: { operation: "interview.question_repair" },
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "You are a strict editor. Output only the cleaned text." }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
      }),
    })

    if (!response.ok) {
      return { original, repaired: original, changed: false }
    }

    const payload = await response.json()
    const repaired = extractText(payload) || original
    
    return {
      original,
      repaired: repaired.trim(),
      changed: original.trim() !== repaired.trim(),
    }
  } catch (error) {
    console.error("AI repair failed", error)
    return { original, repaired: original, changed: false }
  }
}

function extractText(response: any) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim()
  }
  return (response.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((item: any) => item.type === "output_text" || item.type === "text")
    .map((item: any) => item.text ?? "")
    .join("")
    .trim()
}

export async function repairQuestionsBatch(inputs: RepairQuestionInput[]): Promise<RepairQuestionOutput[]> {
  return Promise.all(inputs.map(repairQuestionTextAI))
}

// Keep synchronous version for legacy if needed, but it won't do much now
export function repairQuestionText(input: RepairQuestionInput): RepairQuestionOutput {
  return {
    original: input.question_text,
    repaired: input.question_text,
    changed: false
  }
}
