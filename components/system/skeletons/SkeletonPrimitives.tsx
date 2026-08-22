import type { CSSProperties, HTMLAttributes, ReactNode } from "react"

type SkeletonBlockProps = {
  className?: string
  style?: CSSProperties
}

type SkeletonPanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  className?: string
}

export function SkeletonBlock({ className = "", style }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={`verisnova-skeleton relative overflow-hidden rounded-xl border border-cyan-300/10 bg-slate-900/70 ${className}`}
      style={style}
    />
  )
}

export function SkeletonPanel({ children, className = "", ...props }: SkeletonPanelProps) {
  return (
    <div
      className={`rounded-2xl border border-slate-800 bg-[#111a2e]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export function SkeletonLabel({ width = "50%" }: { width?: string }) {
  return <SkeletonBlock className="h-3 rounded-full" style={{ width }} />
}
