"use client"

import { use as usePromise } from "react"

import OrgUnitDetail from "@/components/employees/OrgUnitDetail"

export default function ProjectDetailPage({ params }) {
  const { id } = usePromise(params)
  return <OrgUnitDetail kind="project" id={id} />
}
