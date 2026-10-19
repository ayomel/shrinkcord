import { callShrinkcord } from "@/lib/server/shrinkcord-api"

export function GET(request: Request) {
  return callShrinkcord(request, "health")
}
