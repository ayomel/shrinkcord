const UPSTREAM_TIMEOUT_MS = 15_000

function apiHealthUrl(): URL | null {
  const configured = process.env.SHRINKCORD_API_URL
  if (!configured) return null
  try {
    const url = new URL(configured)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/health`
    return url
  } catch {
    return null
  }
}

export async function GET() {
  const url = apiHealthUrl()
  if (!url) {
    return Response.json({ message: "Shrinkcord API is unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }

  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: timeout,
    })
    if (!response.ok) {
      return Response.json({ message: "Upstream request failed" }, { status: response.status, headers: { "Cache-Control": "no-store" } })
    }
    const body = await response.json()
    return Response.json(body, { status: 200, headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ message: "Shrinkcord API is unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
