"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

type ValidationResponse = {
  valid: boolean
  reason?:
    | "INVALID"
    | "EXPIRED"
    | "ALREADY_USED"
    | "USED_OR_CANCELLED"
    | "INVALID_TIME_WINDOW"
    | "NOT_STARTED"
    | "SERVER_ERROR"
  interviewId?: string
  candidateId?: string
}

const errorMessages: Record<string, string> = {
  INVALID: "Invalid link",
  EXPIRED: "Link expired",
  ALREADY_USED: "Link already used",
  USED_OR_CANCELLED: "Link not active",
  INVALID_TIME_WINDOW: "Invalid interview schedule",
  NOT_STARTED: "Interview has not started yet",
  SERVER_ERROR: "Unable to validate link",
}

export default function InterviewTokenPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === "string" ? params.token : ""

  const [isLoading, setIsLoading] = useState(true)
  const [result, setResult] = useState<ValidationResponse | null>(null)

  useEffect(() => {
    let isMounted = true

    async function validateToken() {
      if (!token) {
        if (isMounted) {
          setResult({ valid: false, reason: "INVALID" })
          setIsLoading(false)
        }
        return
      }

      try {
        const response = await fetch("/api/interview/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        })

        const data = (await response.json()) as ValidationResponse

        if (!isMounted) {
          return
        }

        setResult(
          data.valid
            ? data
            : {
                valid: false,
                reason: data.reason ?? "SERVER_ERROR",
              }
        )
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setResult({ valid: false, reason: "SERVER_ERROR" })
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void validateToken()

    return () => {
      isMounted = false
    }
  }, [token])

  return (
    <main className="hv-preserve-dark min-h-screen bg-[#020817] px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/80 p-8 shadow-2xl">
        {isLoading ? (
          <>
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Validating</p>
            <h1 className="mt-4 text-3xl font-semibold">Checking your interview link...</h1>
          </>
        ) : result?.valid ? (
          <>
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-400">Ready</p>
            <h1 className="mt-4 text-3xl font-semibold">Interview Ready</h1>
            <div className="mt-6 space-y-3 text-slate-300">
              <p>Candidate ID: {result.candidateId}</p>
              <p>Interview ID: {result.interviewId}</p>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm uppercase tracking-[0.3em] text-rose-400">Access Error</p>
            <h1 className="mt-4 text-3xl font-semibold">
              {errorMessages[result?.reason ?? "SERVER_ERROR"]}
            </h1>
          </>
        )}
      </div>
    </main>
  )
}
