import { callShrinkcord, parseUploadBody, routeError } from "@/lib/server/shrinkcord-api"

export async function POST(request: Request) {
  const body = await parseUploadBody(request)
  if (routeError(body)) return body
  return callShrinkcord(request, "uploads", { method: "POST", body })
}
