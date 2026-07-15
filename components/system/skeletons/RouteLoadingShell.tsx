import { VerisGlobeLoader } from "@/components/system/loaders"

type RouteLoadingShellProps = {
  title: string
  subtitle?: string
  tableColumns?: number
  mode?: "dashboard" | "table" | "reports" | "forensic"
  intelligenceVariant?: "dashboard" | "candidates" | "veris" | "interviews" | "reports" | "default"
  intelligenceSteps?: string[]
}

const defaultStepsByMode = {
  dashboard: [
    { label: "Syncing dashboard", detail: "Loading hiring workflow, alerts, and workspace metrics." },
    { label: "Reading pipeline", detail: "Preparing candidate and interview activity." },
    { label: "Building overview", detail: "Assembling recruiter intelligence cards." },
    { label: "Dashboard ready", detail: "Your dashboard is ready for review." },
  ],
  table: [
    { label: "Loading records", detail: "Fetching recruiter records and workspace permissions." },
    { label: "Reading profiles", detail: "Preparing candidate and hiring activity details." },
    { label: "Building table", detail: "Organizing records into the recruiter view." },
    { label: "Records ready", detail: "The table is ready for review." },
  ],
  reports: [
    { label: "Loading reports", detail: "Fetching hiring analytics and review signals." },
    { label: "Reading metrics", detail: "Preparing interview, candidate, and workflow trends." },
    { label: "Building analysis", detail: "Assembling report cards and charts." },
    { label: "Reports ready", detail: "Analytics are ready for review." },
  ],
  forensic: [
    { label: "Loading insights", detail: "Fetching VERIS evidence and candidate intelligence." },
    { label: "Reading signals", detail: "Preparing risk, recommendation, and score details." },
    { label: "Building review", detail: "Organizing evidence for recruiter decisioning." },
    { label: "Insights ready", detail: "VERIS insights are ready for review." },
  ],
}

export default function RouteLoadingShell({
  title,
  subtitle,
  mode = "table",
  intelligenceSteps,
}: RouteLoadingShellProps) {
  const generatedSteps = intelligenceSteps?.length
    ? intelligenceSteps.map((step) => ({ label: step, detail: subtitle ?? "Preparing recruiter workspace data." }))
    : defaultStepsByMode[mode]

  return (
    <VerisGlobeLoader
      eyebrow={title}
      steps={generatedSteps}
      activeIndex={1}
      fullscreen
    />
  )
}
