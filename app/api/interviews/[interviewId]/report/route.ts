import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse } from "@/lib/server/response"
import { generateCandidateReportPdf } from "@/lib/server/services/candidate-report-pdf"

type Params = {
  params: Promise<{
    interviewId: string
  }>
}

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { interviewId } = await params
    const report = await generateCandidateReportPdf(auth.organizationId, interviewId)
    const body = new Uint8Array(report.bytes).buffer

    return new Response(new Blob([body], { type: "application/pdf" }), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${report.filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
