/**
 * Curated, role-neutral competency library for Interview Focus.
 *
 * Every entry must make sense for any profession: a teacher, a nurse, a sales
 * manager and a database administrator can all be assessed on each of them.
 * Role-specific subject matter (clinical practice, pipeline management,
 * PostgreSQL) belongs under "role_knowledge" and comes from the job itself -
 * it is never a separate "technical" competency, which is what keeps the
 * library free of technical bias.
 *
 * Keys are stable identifiers stored in interview_focus_areas.area_key and
 * job_questionnaire_questions.focus_area_key. Never rename a key; add a new one.
 */

export type CompetencyDefinition = {
  key: string
  label: string
  /** What the competency means, phrased for any role. Shown to recruiters and the generator. */
  description: string
  /** Default one-line reason used when the recommendation comes from the deterministic fallback. */
  defaultRationale: string
}

export const COMPETENCY_LIBRARY: readonly CompetencyDefinition[] = [
  {
    key: "role_knowledge",
    label: "Role Knowledge & Expertise",
    description: "Depth of the knowledge, skills and practice this specific role requires, in the role's own terms.",
    defaultRationale: "Confirms the candidate can do the core work of this role.",
  },
  {
    key: "problem_solving",
    label: "Problem Solving",
    description: "Breaking down unfamiliar problems, finding causes and choosing workable solutions.",
    defaultRationale: "The role regularly meets problems without a ready-made answer.",
  },
  {
    key: "analytical_thinking",
    label: "Analytical Thinking",
    description: "Using evidence, numbers and observations to reach sound conclusions.",
    defaultRationale: "Decisions in this role depend on reading data or evidence well.",
  },
  {
    key: "communication",
    label: "Communication",
    description: "Explaining ideas clearly, listening, and adapting the message to the audience.",
    defaultRationale: "Much of the role's impact depends on clear communication.",
  },
  {
    key: "stakeholder_management",
    label: "Stakeholder Management",
    description: "Building trust and managing expectations with the people the role works with or for.",
    defaultRationale: "The role balances the needs of several groups of people.",
  },
  {
    key: "collaboration",
    label: "Teamwork & Collaboration",
    description: "Working effectively with others, sharing work and resolving friction constructively.",
    defaultRationale: "The work is delivered with and through other people.",
  },
  {
    key: "leadership",
    label: "Leadership & People Development",
    description: "Setting direction, motivating others and developing the people around them.",
    defaultRationale: "The role is expected to lead or develop others.",
  },
  {
    key: "planning_prioritisation",
    label: "Planning & Prioritisation",
    description: "Organising work, managing time and choosing what matters most under competing demands.",
    defaultRationale: "The role juggles competing priorities and deadlines.",
  },
  {
    key: "judgement",
    label: "Judgement & Decision Making",
    description: "Making sound, timely decisions with incomplete information and owning the consequences.",
    defaultRationale: "The role makes decisions that carry real consequences.",
  },
  {
    key: "customer_focus",
    label: "Customer & Service Focus",
    description: "Understanding the needs of the people the role serves and delivering for them.",
    defaultRationale: "The role directly serves customers, clients, patients or learners.",
  },
  {
    key: "commercial_awareness",
    label: "Commercial Awareness",
    description: "Understanding how the work creates value, affects cost and supports business goals.",
    defaultRationale: "The role's results are measured in business or financial terms.",
  },
  {
    key: "strategic_thinking",
    label: "Strategic Thinking",
    description: "Seeing the bigger picture, anticipating change and linking actions to long-term goals.",
    defaultRationale: "The role shapes direction beyond day-to-day delivery.",
  },
  {
    key: "quality_accuracy",
    label: "Quality, Accuracy & Compliance",
    description: "Getting details right, following standards and managing risk.",
    defaultRationale: "Mistakes in this role are costly, so accuracy and standards matter.",
  },
  {
    key: "ownership",
    label: "Ownership & Accountability",
    description: "Taking responsibility for outcomes, following through and learning from mistakes.",
    defaultRationale: "The role needs people who see work through to the end.",
  },
  {
    key: "adaptability",
    label: "Adaptability & Learning",
    description: "Adjusting to change, learning quickly and staying effective under uncertainty.",
    defaultRationale: "The role changes often and rewards fast learning.",
  },
]

const BY_KEY = new Map(COMPETENCY_LIBRARY.map((entry) => [entry.key, entry]))

export function getCompetency(key: string): CompetencyDefinition | undefined {
  return BY_KEY.get(key)
}

export function isLibraryCompetency(key: string) {
  return BY_KEY.has(key)
}

export const LIBRARY_KEYS: readonly string[] = COMPETENCY_LIBRARY.map((entry) => entry.key)
