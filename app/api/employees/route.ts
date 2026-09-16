import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { createEmployeeSchema, listEmployeesQuerySchema } from "@/lib/server/employees/validators"
import { errorResponse, successResponse } from "@/lib/server/response"
import { createEmployee, listEmployees } from "@/lib/server/services/employee"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.view")

    const url = new URL(request.url)
    const query = listEmployeesQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    })

    const result = await listEmployees(auth.organizationId, query)
    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.create")

    const payload = createEmployeeSchema.parse(await request.json())
    const employee = await createEmployee(auth.organizationId, payload)

    return successResponse(employee, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
