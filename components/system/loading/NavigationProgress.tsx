"use client"

import { VerisGlobeLoader } from "@/components/system/loaders"

type NavigationProgressProps = {
  active?: boolean
  message?: string
}

export default function NavigationProgress({
  active = true,
  message = "Preparing recruiter insights...",
}: NavigationProgressProps) {
  if (!active) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[130]">
      <VerisGlobeLoader
        eyebrow="VerisNova"
        steps={[
          { label: "Opening screen", detail: "Securing recruiter session and route context." },
          { label: message.replace(/\.+$/, ""), detail: "Loading data for this recruiter screen." },
          { label: "Building view", detail: "Organizing records into the recruiter screen." },
          { label: "Screen ready", detail: "The recruiter workspace is ready for review." },
        ]}
        activeIndex={1}
        fullscreen
      />
    </div>
  )
}
