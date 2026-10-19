const MAX_BODY_BYTES = 8 * 1024
const MAX_ERROR_BYTES = 64 * 1024
const UPSTREAM_TIMEOUT_MS = 15_000
const MAX_SIZE_BYTES = 524_288_000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9._:-]{1,255}$/
const SAFE_INPUT_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,1023}$/

type JsonRecord = Record<string, unknown>
type RouteParams = { params: Promise<{ id: string }> }

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function configBaseUrl(): URL | null {
  const configured = process.env.SHRINKCORD_API_URL
  if (!configured) return null

  try {
    const url = new URL(configured)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    url.pathname = url.pathname.replace(/\/+$/, "")
    return url
  } catch {
    return null
  }
}

function apiUrl(path: string): URL | null {
  const base = configBaseUrl()
  if (!base) return null
  base.pathname = `${base.pathname}/${path}`.replace(/\/{2,}/g, "/")
  return base
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const length = request.headers.get("content-length")
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return null
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function parseJsonRequest(request: Request): Promise<JsonRecord | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") return null
  const body = await readBoundedBody(request)
  if (!body) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function onlyFields(body: JsonRecord, allowed: string[]) {
  return Object.keys(body).every((key) => allowed.includes(key))
}

function validSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_SIZE_BYTES
}

export async function parseUploadBody(request: Request): Promise<{ content_length?: number } | Response> {
  const body = await parseJsonRequest(request)
  if (!body || !onlyFields(body, ["content_length"])) return json({ message: "Invalid request body" }, 400)
  if (body.content_length !== undefined && !validSize(body.content_length)) return json({ message: "Invalid request body" }, 400)
  return body.content_length === undefined ? {} : { content_length: body.content_length as number }
}

export async function parseCreateJobBody(request: Request): Promise<{ input_key: string; target_size_bytes: number } | Response> {
  const body = await parseJsonRequest(request)
  if (!body || !onlyFields(body, ["input_key", "target_size_bytes"])) return json({ message: "Invalid request body" }, 400)
  if (typeof body.input_key !== "string" || !SAFE_INPUT_KEY.test(body.input_key) || body.input_key.includes("..") || !validSize(body.target_size_bytes)) {
    return json({ message: "Invalid request body" }, 400)
  }
  return { input_key: body.input_key, target_size_bytes: body.target_size_bytes }
}

export function validateIdempotencyKey(request: Request): Response | null {
  const key = request.headers.get("idempotency-key")
  if (request.headers.has("idempotency-key") && (!key || !IDEMPOTENCY_KEY.test(key))) {
    return json({ message: "Invalid Idempotency-Key" }, 400)
  }
  return null
}

export function validateId(id: string): Response | null {
  return UUID_V4.test(id) ? null : json({ message: "Invalid job ID" }, 400)
}

function safeErrorMessage(body: string): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(body)
    if (!isRecord(parsed)) return { message: "Upstream request failed" }
    for (const field of ["message", "detail", "error"]) {
      const value = parsed[field]
      if (typeof value === "string" && value.length > 0) return { [field]: value.slice(0, 500) }
      if (Array.isArray(value) && value.length <= 10 && value.every((item) => typeof item === "string")) {
        return { [field]: value.map((item: string) => item.slice(0, 500)) }
      }
    }
  } catch {
    // Upstream error bodies are untrusted; malformed or non-JSON content gets a generic message.
  }
  return { message: "Upstream request failed" }
}

async function readUpstreamBody(response: Response): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_ERROR_BYTES) {
      await reader.cancel()
      return ""
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function upstreamResponse(response: Response, path: string): Promise<Response> {
  const headers = { "Cache-Control": "no-store" }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (response.status === 204 || response.status === 205) {
    return new Response(null, { status: response.status, headers })
  }
  const body = await readUpstreamBody(response)
  if (response.headers.get("content-length") && Number(response.headers.get("content-length")) > MAX_ERROR_BYTES) {
    return response.ok
      ? Response.json({ message: "Upstream returned an unsupported response" }, { status: 502, headers })
      : Response.json({ message: "Upstream request failed" }, { status: response.status, headers })
  }

  if (!response.ok) return Response.json(safeErrorMessage(body), { status: response.status, headers })
  if (path === "health" && ["text/html", "text/plain"].includes(contentType ?? "") && body.trim() === "OK") {
    return new Response("OK", { status: response.status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } })
  }
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    return Response.json({ message: "Upstream returned an unsupported response" }, { status: 502, headers })
  }
  try {
    return Response.json(JSON.parse(body), { status: response.status, headers })
  } catch {
    return Response.json({ message: "Upstream returned an invalid response" }, { status: 502, headers })
  }
}

export async function callShrinkcord(request: Request, path: string, options: { method?: string; body?: unknown; forwardIdempotencyKey?: boolean } = {}) {
  const url = apiUrl(path)
  if (!url) return json({ message: "Shrinkcord API is unavailable" }, 503)

  const headers = new Headers({ Accept: "application/json" })
  let body: string | undefined
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(options.body)
  }
  if (options.forwardIdempotencyKey) {
    const key = request.headers.get("idempotency-key")
    if (key) headers.set("Idempotency-Key", key)
  }

  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  const signal = AbortSignal.any([request.signal, timeout])
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal,
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      return json({ message: "Upstream request failed" }, 502)
    }
    return await upstreamResponse(response, path)
  } catch {
    if (timeout.aborted) return json({ message: "Shrinkcord API timed out" }, 504)
    if (request.signal.aborted) return json({ message: "Request was cancelled" }, 499)
    return json({ message: "Shrinkcord API is unavailable" }, 503)
  }
}

export function routeError(response: unknown): response is Response {
  return response instanceof Response
}

export async function jobParams(context: RouteParams): Promise<{ id: string } | Response> {
  const { id } = await context.params
  const invalid = validateId(id)
  return invalid ?? { id }
}
