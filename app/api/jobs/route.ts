import { callShrinkcord, parseCreateJobBody, routeError, validateIdempotencyKey } from "@/lib/server/shrinkcord-api"

export async function POST(request: Request) {
  const invalidKey = validateIdempotencyKey(request)
  if (invalidKey) return invalidKey
  const body = await parseCreateJobBody(request)
  if (routeError(body)) return body
  return callShrinkcord(request, "jobs", { method: "POST", body, forwardIdempotencyKey: true })
}
