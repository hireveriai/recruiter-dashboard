import { ZodError } from "zod"
import { NextResponse } from "next/server"

import { isApiError } from "@/lib/server/errors"

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status }
  )
}

export function errorResponse(error: unknown) {
  if (isApiError(error)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...error.details,
        },
      },
      { status: error.statusCode }
    )
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0]
    const fieldPath = firstIssue?.path?.join(".")
    const message = fieldPath ? `${fieldPath}: ${firstIssue.message}` : firstIssue?.message || "Invalid request payload"

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message,
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 }
    )
  }

  console.error(error)

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error",
      },
    },
    { status: 500 }
  )
}
