"use client"

import { use as usePromise } from "react"

import OrgUnitDetail from "@/components/employees/OrgUnitDetail"

export default function DepartmentDetailPage({ params }) {
  const { id } = usePromise(params)
  return <OrgUnitDetail kind="department" id={id} />
}
