import { reportServerError } from "@/lib/server/error-reporting"

export async function onRequestError(
  error: unknown,
  request: { method?: string },
  context: { routePath?: string; routeType?: string }
) {
  await reportServerError("recruiter-dashboard", error, request, context)
}
