"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import HorizontalWorkflow from "@/components/ui/HorizontalWorkflow"
import { apiRequest } from "@/components/employees/shared"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

/**
 * The employee-assessment journey, end to end, in the same visual language
 * as the candidate Assessment Flow (components/ui/HorizontalWorkflow.js):
 *
 *   Departments (optional) → Projects (optional) → Add Employees →
 *   Create & Publish → Assign → Track Results
 *
 * Departments and projects are optional — an assessment can always go to
 * hand-picked employees — but they have to exist before employees can be
 * placed in them or targeted by them, so the guide says so explicitly.
 */

const STEPS = [
  {
    id: "departments",
    number: 1,
    title: "Departments",
    optional: true,
    description: "Optional. Create teams such as Engineering or HR, so you can assign an assessment to a whole department.",
  },
  {
    id: "projects",
    number: 2,
    title: "Projects",
    optional: true,
    description: "Optional. Create projects; an employee can be on several. Lets you assign by project, or department + project.",
  },
  {
    id: "employees",
    number: 3,
    title: "Add Employees",
    description: "Add people and, if you use them, pick their department and projects.",
  },
  {
    id: "publish",
    number: 4,
    title: "Create & Publish",
    description: "Create an employee assessment, generate and review questions, then publish it.",
  },
  {
    id: "assign",
    number: 5,
    title: "Assign",
    description: "Send it to selected employees, a department, a project, or a department + project.",
  },
  {
    id: "results",
    number: 6,
    title: "Track Results",
    description: "Follow completion, scores and pass rate per employee.",
  },
]

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function flowState(o) {
  const done = {
    departments: o.departments > 0,
    projects: o.projects > 0,
    employees: o.activeEmployees > 0,
    publish: o.publishedAssessments > 0,
    assign: o.assigned > 0,
    results: o.completed > 0,
  }

  // The next required step; optional steps are recommended, never blocking.
  if (!done.employees) {
    if (!done.departments) {
      return {
        done,
        activeId: "departments",
        recommendation:
          "Start by creating your departments (optional). They must exist before you can place employees in them or assign an assessment to a whole team. You can also skip straight to adding employees.",
        chip: "Start here",
        actions: [
          { label: "Create Departments", href: "/employees/departments" },
          { label: "Skip, add employees", href: "/employees?add=1", secondary: true },
        ],
      }
    }
    if (!done.projects) {
      return {
        done,
        activeId: "projects",
        recommendation: `${plural(o.departments, "department is", "departments are")} ready. Next, create projects (optional) if you want to assign by project, then add employees.`,
        chip: "Optional step",
        actions: [
          { label: "Create Projects", href: "/employees/projects" },
          { label: "Skip, add employees", href: "/employees?add=1", secondary: true },
        ],
      }
    }
    return {
      done,
      activeId: "employees",
      recommendation: "Departments and projects are set up. Now add your employees and place them in a department and projects.",
      chip: "Next step",
      actions: [{ label: "Add Employees", href: "/employees?add=1" }],
    }
  }

  const unplaced =
    o.departments > 0 && o.withoutDepartment > 0
      ? ` ${plural(o.withoutDepartment, "active employee has", "active employees have")} no department yet and won't be reached by department targeting.`
      : ""

  if (!done.publish) {
    return {
      done,
      activeId: "publish",
      recommendation: `${plural(o.activeEmployees, "active employee", "active employees")} ready. Create an employee assessment, review its questions and publish it.${unplaced}`,
      chip: o.draftAssessments ? plural(o.draftAssessments, "draft", "drafts") : "Next step",
      actions: [
        o.draftAssessments
          ? { label: "Finish a Draft", href: "/assessments?audience=EMPLOYEE" }
          : { label: "Create Assessment", href: "/assessments?audience=EMPLOYEE", kind: "create" },
      ],
    }
  }

  if (!done.assign) {
    return {
      done,
      activeId: "assign",
      recommendation: `${plural(o.publishedAssessments, "published assessment is", "published assessments are")} ready. Use Assign to send one to employees, a department or a project.${unplaced}`,
      chip: `${o.publishedAssessments} published`,
      actions: [{ label: "Assign Assessment", href: "/assessments?audience=EMPLOYEE", kind: "assign" }],
    }
  }

  return {
    done,
    activeId: "results",
    recommendation:
      o.completed === 0
        ? `${plural(o.assigned, "assignment is", "assignments are")} out. Results appear as employees complete them.${unplaced}`
        : `${o.completed} of ${o.assigned} assignments completed. Open an assessment's Results for scores and pass rate.${unplaced}`,
    chip: `${o.completed} completed`,
    actions: [{ label: "View Assessments", href: "/assessments?audience=EMPLOYEE" }],
  }
}

export default function EmployeeFlowGuide({ refreshKey = 0, className = "", onCreateAssessment = null, onAssignAssessment = null }) {
  const searchParams = useAuthSearchParams()
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiRequest("/api/employees/overview", searchParams).then((res) => {
      if (!cancelled && res.ok) setOverview(res.data)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const state = overview ? flowState(overview) : null
  const steps = STEPS.map((step) => {
    const isDone = state?.done[step.id]
    const isActive = state?.activeId === step.id
    return {
      ...step,
      status: !state ? "pending" : isActive ? "active" : isDone ? "completed" : "pending",
      statusLabel:
        state && !isActive && !isDone && step.optional
          ? "Optional"
          : state && isDone && (step.id === "departments" || step.id === "projects")
            ? plural(step.id === "departments" ? overview.departments : overview.projects, "created", "created")
            : undefined,
    }
  })

  return (
    <HorizontalWorkflow
      className={className}
      theme="cyan"
      eyebrow="Employee Assessment Flow · Setup Guide"
      recommendation={state ? state.recommendation : "Checking your setup…"}
      chips={
        state
          ? [
              { label: `${STEPS.filter((s) => state.done[s.id]).length} of ${STEPS.length} steps done` },
              { label: state.chip, tone: "muted" },
            ]
          : []
      }
      steps={steps}
      action={
        state?.actions?.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {state.actions.map((action) => {
              const className = action.secondary
                ? "inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-400 hover:text-white"
                : // Not the shared workflowActionClass: its hover background is remapped
                  // dark in the light theme while its text stays dark, hiding the label.
                  "hv-solid-action inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
              // On the Assessments page, Create / Assign open their dialogs in place.
              const onClick =
                action.kind === "create" ? onCreateAssessment : action.kind === "assign" ? onAssignAssessment : null
              if (onClick) {
                return (
                  <button key={action.label} type="button" onClick={onClick} className={className}>
                    {action.label}
                  </button>
                )
              }
              return (
                <Link key={action.label} href={buildAuthUrl(action.href, searchParams)} className={className}>
                  {action.label}
                </Link>
              )
            })}
          </div>
        ) : null
      }
    />
  )
}
