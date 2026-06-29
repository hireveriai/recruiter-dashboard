export enum InterviewQuestionType {
  CODING = "coding",
  TECHNICAL_DISCUSSION = "technical_discussion",
  SYSTEM_DESIGN = "system_design",
  BEHAVIORAL = "behavioral",
  ARCHITECTURE = "architecture",
  TROUBLESHOOTING = "troubleshooting",
  MCQ = "mcq",
  CASE_STUDY = "case_study",
}

export type QuestionRenderingMode =
  | "code_editor"
  | "discussion"
  | "system_design"
  | "behavioral"
  | "architecture"
  | "troubleshooting"
  | "mcq"
  | "case_study";

export type QuestionClassificationResult = {
  questionType: InterviewQuestionType;
  confidence: number;
  renderingMode: QuestionRenderingMode;
  rationale: string;
};

const TYPE_VALUES = new Set<string>(Object.values(InterviewQuestionType));

function normalizeText(value: string | null | undefined) {
  return value?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function normalizeInterviewQuestionType(
  value: string | null | undefined,
  fallback: InterviewQuestionType = InterviewQuestionType.TECHNICAL_DISCUSSION
) {
  const normalized = normalizeText(value).replace(/[\s-]+/g, "_");

  if (TYPE_VALUES.has(normalized)) {
    return normalized as InterviewQuestionType;
  }

  if (normalized === "open_ended" || normalized === "technical") {
    return fallback;
  }

  return fallback;
}

export function getQuestionRenderingMode(
  questionType: InterviewQuestionType | string | null | undefined
): QuestionRenderingMode {
  switch (normalizeInterviewQuestionType(questionType)) {
    case InterviewQuestionType.CODING:
      return "code_editor";
    case InterviewQuestionType.SYSTEM_DESIGN:
      return "system_design";
    case InterviewQuestionType.BEHAVIORAL:
      return "behavioral";
    case InterviewQuestionType.ARCHITECTURE:
      return "architecture";
    case InterviewQuestionType.TROUBLESHOOTING:
      return "troubleshooting";
    case InterviewQuestionType.MCQ:
      return "mcq";
    case InterviewQuestionType.CASE_STUDY:
      return "case_study";
    case InterviewQuestionType.TECHNICAL_DISCUSSION:
    default:
      return "discussion";
  }
}

export function classifyInterviewQuestion(
  question: string,
  jobRole?: string,
  skillTags: string[] = []
): QuestionClassificationResult {
  const text = normalizeText([question, jobRole, ...skillTags].filter(Boolean).join(" "));
  const questionText = normalizeText(question);

  const discussionGuardrails = [
    /\btell me about\b/,
    /\bdescribe\b/,
    /\bexplain\b/,
    /\bwalk me through\b/,
    /\bhow did you\b/,
    /\bhow do you\b/,
    /\bexperience\b/,
    /\blessons learned\b/,
  ];

  if (
    includesAny(questionText, [
      /\bmultiple choice\b/,
      /\bchoose (one|the correct|the best)\b/,
      /\bwhich of the following\b/,
      /\boptions?\s*:/,
      /\b[a-d]\)\s+\w+/,
    ])
  ) {
    return { questionType: InterviewQuestionType.MCQ, confidence: 0.92, renderingMode: "mcq", rationale: "Objective multiple-choice wording detected." };
  }

  if (
    includesAny(questionText, [
      /\b(write|implement|create|build)\s+(a|an|the)?\s*(function|method|class|api|component|program|script|query|stored procedure|table)\b/,
      /\b(write|implement|create|build)\s+(a|an|the)?\s*(node\.?js|javascript|typescript|ts|js|python|java|go|rust|c\+\+|c#)?\s*(function|method|class|utility|validator|parser|handler)\b/,
      /\bfunction\s+that\s+(validates?|returns?|parses?|checks?|handles?)\b/,
      /\b(validates?|validate)\s+an?\s+api\s+payload\b/,
      /\btyped\s+(success|error)\s+result\b/,
      /\bsolve (this|the)?\s*(algorithm|coding challenge|programming problem)\b/,
      /\bdebug (this|the)?\s*(code|function|program|query)\b/,
      /\bfix (this|the)?\s*(code|bug|query)\b/,
      /\boptimi[sz]e (this|the)?\s*(query|code|function|algorithm)\b/,
      /\breturn executable\b/,
      /\bsubmit code\b/,
      /\bcoding challenge\b/,
    ]) &&
    !includesAny(questionText, discussionGuardrails)
  ) {
    return { questionType: InterviewQuestionType.CODING, confidence: 0.9, renderingMode: "code_editor", rationale: "Question asks for executable code, query, API, component, or algorithm output." };
  }

  if (
    includesAny(text, [
      /\bdesign (a|an|the)?\s*(scalable|distributed|high availability|payment|chat|feed|system|platform|service)\b/,
      /\bsystem design\b/,
      /\bhow would you build\b/,
      /\barchitecture diagram\b/,
      /\bdistributed system\b/,
      /\bha\/dr\b|\bhigh availability\b|\bdisaster recovery\b/,
    ])
  ) {
    return { questionType: InterviewQuestionType.SYSTEM_DESIGN, confidence: 0.88, renderingMode: "system_design", rationale: "System design, scalability, or distributed architecture signals detected." };
  }

  if (
    includesAny(text, [
      /\bproduction outage\b/,
      /\bincident\b/,
      /\broot cause\b|\brca\b/,
      /\bdeadlock\b/,
      /\bmemory leak\b/,
      /\bhigh cpu\b/,
      /\breplication lag\b/,
      /\bapi failure\b/,
      /\bwhat would you check\b/,
      /\btroubleshoot\b/,
    ])
  ) {
    return { questionType: InterviewQuestionType.TROUBLESHOOTING, confidence: 0.84, renderingMode: "troubleshooting", rationale: "Incident, debugging, or root-cause analysis signals detected." };
  }

  if (includesAny(text, [/\bcase study\b/, /\bscenario\b/, /\bclient escalation\b/, /\bmigration scenario\b/, /\btrade[- ]?off analysis\b/])) {
    return { questionType: InterviewQuestionType.CASE_STUDY, confidence: 0.82, renderingMode: "case_study", rationale: "Scenario-driven case evaluation wording detected." };
  }

  if (includesAny(text, [/\btell me about a time\b/, /\bconflict\b/, /\bleadership\b/, /\bteamwork\b/, /\bpressure\b/, /\bfailure\b/, /\bownership\b/, /\bcommunication\b/, /\bstar\b/])) {
    return { questionType: InterviewQuestionType.BEHAVIORAL, confidence: 0.86, renderingMode: "behavioral", rationale: "Leadership, teamwork, conflict, or STAR-style wording detected." };
  }

  if (includesAny(text, [/\benterprise architecture\b/, /\bplatform modernization\b/, /\bcloud strategy\b/, /\bsecurity architecture\b/, /\bgovernance\b/, /\broadmap\b/, /\bprincipal\b|\bstaff\b|\bstrategy\b/])) {
    return { questionType: InterviewQuestionType.ARCHITECTURE, confidence: 0.8, renderingMode: "architecture", rationale: "Strategic architecture or governance wording detected." };
  }

  return {
    questionType: InterviewQuestionType.TECHNICAL_DISCUSSION,
    confidence: 0.72,
    renderingMode: "discussion",
    rationale: "Defaulted to technical discussion because no executable coding requirement was found.",
  };
}
