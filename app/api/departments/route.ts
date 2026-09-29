import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { createDepartmentSchema, listOrgUnitsQuerySchema } from "@/lib/server/employees/validators"
import { errorResponse, successResponse } from "@/lib/server/response"
import { createDepartment, listDepartments } from "@/lib/server/services/org-units"

// Departments are managed under the existing employees.* permissions.
export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.view")

    const url = new URL(request.url)
    const query = listOrgUnitsQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    })

    return successResponse(await listDepartments(auth.organizationId, query))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.create")

    const payload = createDepartmentSchema.parse(await request.json())
    return successResponse(await createDepartment(auth.organizationId, payload), 201)
  } catch (error) {
    return errorResponse(error)
  }
}
