import { callShrinkcord, jobParams, routeError } from "@/lib/server/shrinkcord-api"

export async function GET(request: Request, context: RouteContext<"/api/jobs/[id]">) {
  const params = await jobParams(context)
  if (routeError(params)) return params
  return callShrinkcord(request, `jobs/${params.id}`)
}
