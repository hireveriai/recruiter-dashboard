export class ApiError extends Error {
  statusCode: number
  code: string
  // Extra fields merged into the error response body alongside code/message
  // (e.g. AI_GENERATION_LIMIT_REACHED's generationLimit/remainingGenerations).
  details?: Record<string, unknown>

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "ApiError"
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
