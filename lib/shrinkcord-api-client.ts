import { getShrinkcordApiBaseUrl, shrinkcordApiUrl } from "@/lib/shrinkcord-api-url"
import { normalizeCompressProgress } from "@/lib/video-progress"

export type ShrinkcordJobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELED"

export type ShrinkcordJob = {
  id: string
  status: ShrinkcordJobStatus
  progress: number
  target_size_bytes: number | null
  source_bytes: number | null
  output_bytes: number | null
  error_message: string | null
}

export type ShrinkcordApiErrorCode =
  | "too_large"
  | "too_long"
  | "unsupported"
  | "corrupt"
  | "server_busy"
  | "network"
  | "canceled"
  | "unknown"

export class ShrinkcordApiError extends Error {
  readonly code: ShrinkcordApiErrorCode
  readonly status?: number
  readonly retryable: boolean

  constructor(
    code: ShrinkcordApiErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message)
    this.name = "ShrinkcordApiError"
    this.code = code
    this.status = options.status
    this.retryable = options.retryable ?? false
  }
}

export type UploadJobOptions = {
  file: File
  targetSizeBytes?: number
  signal?: AbortSignal
  baseUrl?: string
  onUploadProgress?: (loaded: number, total: number) => void
  /** Milliseconds to wait before retrying a 429. */
  rateLimitRetryDelayMs?: number
  maxRateLimitRetries?: number
  /** Test hook: replace the default XHR upload implementation. */
  uploadImpl?: typeof uploadJobWithXhr
}

export type ShrinkcordApiTransport = {
  uploadJob(options: UploadJobOptions): Promise<{ id: string }>
  getJob(jobId: string, signal?: AbortSignal, baseUrl?: string): Promise<ShrinkcordJob>
  cancelJob(jobId: string, signal?: AbortSignal, baseUrl?: string): Promise<ShrinkcordJob>
  downloadJobFile(jobId: string, signal?: AbortSignal, baseUrl?: string): Promise<Blob>
}

const CONTROL_TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000
const DEFAULT_RATE_LIMIT_DELAY_MS = 2_000
const DEFAULT_RATE_LIMIT_RETRIES = 8
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function mapHttpStatusToError(status: number, bodyText: string): ShrinkcordApiError {
  const message = extractErrorMessage(bodyText)
  if (status === 413) {
    return new ShrinkcordApiError("too_large", message || "This video is too large (max 500 MiB).", { status })
  }
  if (status === 415) {
    return new ShrinkcordApiError("unsupported", message || "Unsupported video format. Use MP4 or MOV.", { status })
  }
  if (status === 429) {
    return new ShrinkcordApiError("server_busy", message || "The server is busy. Waiting to retry…", { status, retryable: true })
  }
  if (status === 400) {
    const lower = (message || bodyText).toLowerCase()
    if (lower.includes("duration") || lower.includes("600")) {
      return new ShrinkcordApiError("too_long", message || "This video is longer than 10 minutes.", { status })
    }
    if (lower.includes("corrupt") || lower.includes("invalid") || lower.includes("probe")) {
      return new ShrinkcordApiError("corrupt", message || "This video could not be read. Try another file.", { status })
    }
    return new ShrinkcordApiError("corrupt", message || "This video could not be accepted.", { status })
  }
  if (status >= 500) {
    return new ShrinkcordApiError("unknown", message || "Shrinkcord had a server error. Try again.", { status, retryable: true })
  }
  return new ShrinkcordApiError("unknown", message || `Request failed (HTTP ${status}).`, { status })
}

function extractErrorMessage(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      for (const field of ["message", "detail", "error"]) {
        const value = record[field]
        if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240)
        if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
          return value.join(" ").slice(0, 240)
        }
      }
    }
  } catch {
    // ignore
  }
  return bodyText.trim().slice(0, 240)
}

function parseJob(value: unknown, expectedId?: string): ShrinkcordJob {
  if (!isRecord(value) || typeof value.id !== "string" || !UUID_V4.test(value.id)) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned an invalid job response.", { retryable: true })
  }
  if (expectedId && value.id.toLowerCase() !== expectedId.toLowerCase()) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned a mismatched job ID.", { retryable: false })
  }
  if (!isJobStatus(value.status) || !Number.isInteger(value.progress)) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned an invalid job response.", { retryable: true })
  }

  const status = value.status
  const progress = normalizeCompressProgress(status, value.progress as number)

  return {
    id: value.id,
    status,
    progress,
    target_size_bytes: optionalInt(value.target_size_bytes),
    source_bytes: optionalInt(value.source_bytes),
    output_bytes: optionalInt(value.output_bytes),
    error_message: optionalString(value.error_message),
  }
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) : null
}

function isJobStatus(value: unknown): value is ShrinkcordJobStatus {
  return value === "QUEUED" || value === "PROCESSING" || value === "COMPLETED" || value === "FAILED" || value === "CANCELED"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function abortError(): DOMException {
  return new DOMException("The request was canceled.", "AbortError")
}

function timedSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return AbortSignal.any([signal, timeout])
}

async function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(abortError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

export function uploadJobWithXhr(
  url: string,
  file: File,
  targetSizeBytes: number,
  signal: AbortSignal,
  onUploadProgress?: (loaded: number, total: number) => void,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    let settled = false
    const finish = (error?: Error, result?: { id: string }) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else if (result) resolve(result)
    }
    const onAbort = () => {
      request.abort()
      finish(abortError())
    }

    const form = new FormData()
    form.append("file", file)
    form.append("target_size_bytes", String(targetSizeBytes))

    request.open("POST", url)
    request.timeout = UPLOAD_TIMEOUT_MS
    request.withCredentials = false
    request.setRequestHeader("Accept", "application/json")
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onUploadProgress?.(event.loaded, event.total)
    })
    request.addEventListener("load", () => {
      const body = request.responseText ?? ""
      if (request.status === 201) {
        try {
          const parsed: unknown = JSON.parse(body)
          if (isRecord(parsed) && typeof parsed.id === "string" && UUID_V4.test(parsed.id)) {
            finish(undefined, { id: parsed.id })
            return
          }
        } catch {
          // fall through
        }
        finish(new ShrinkcordApiError("unknown", "Shrinkcord returned an invalid response after upload.", { retryable: true }))
        return
      }
      if (request.status === 429) {
        finish(mapHttpStatusToError(429, body))
        return
      }
      if (request.status === 0) {
        finish(new ShrinkcordApiError("network", "The upload connection closed before it finished.", { retryable: true }))
        return
      }
      finish(mapHttpStatusToError(request.status, body))
    })
    request.addEventListener("error", () => {
      finish(new ShrinkcordApiError("network", "The upload connection failed. Check your connection and try again.", { retryable: true }))
    })
    request.addEventListener("timeout", () => {
      finish(new ShrinkcordApiError("network", "The upload took too long. Check your connection and try again.", { retryable: true }))
    })
    request.addEventListener("abort", () => finish(abortError()))
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    request.send(form)
  })
}

export async function uploadShrinkcordJob(options: UploadJobOptions): Promise<{ id: string }> {
  const baseUrl = options.baseUrl ?? getShrinkcordApiBaseUrl()
  const url = shrinkcordApiUrl("/jobs", baseUrl)
  const targetSizeBytes = options.targetSizeBytes ?? 20_000_000
  const signal = options.signal ?? new AbortController().signal
  const delayMs = options.rateLimitRetryDelayMs ?? DEFAULT_RATE_LIMIT_DELAY_MS
  const maxRetries = options.maxRateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES

  const uploadImpl = options.uploadImpl ?? uploadJobWithXhr
  let attempts = 0
  while (true) {
    try {
      return await uploadImpl(
        url,
        options.file,
        targetSizeBytes,
        timedSignal(signal, UPLOAD_TIMEOUT_MS),
        options.onUploadProgress,
      )
    } catch (error) {
      if (signal.aborted) throw abortError()
      if (error instanceof ShrinkcordApiError && error.status === 429 && attempts < maxRetries) {
        attempts += 1
        await waitMs(delayMs, signal)
        continue
      }
      throw error
    }
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<{ response: Response; text: string }> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    })
    const text = await response.text()
    return { response, text }
  } catch {
    if (signal.aborted) throw abortError()
    throw new ShrinkcordApiError("network", "Could not reach Shrinkcord. Check your connection and try again.", { retryable: true })
  }
}

export async function getShrinkcordJob(
  jobId: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<ShrinkcordJob> {
  if (!UUID_V4.test(jobId)) {
    throw new ShrinkcordApiError("unknown", "This video job ID is invalid.", { retryable: false })
  }
  const url = shrinkcordApiUrl(`/jobs/${encodeURIComponent(jobId)}`, baseUrl)
  const controlSignal = timedSignal(signal ?? new AbortController().signal, CONTROL_TIMEOUT_MS)
  const { response, text } = await fetchJson(url, { method: "GET", headers: { Accept: "application/json" } }, controlSignal)
  if (!response.ok) throw mapHttpStatusToError(response.status, text)
  return parseJob(JSON.parse(text), jobId)
}

export async function cancelShrinkcordJob(
  jobId: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<ShrinkcordJob> {
  if (!UUID_V4.test(jobId)) {
    throw new ShrinkcordApiError("unknown", "This video job ID is invalid.", { retryable: false })
  }
  const url = shrinkcordApiUrl(`/jobs/${encodeURIComponent(jobId)}`, baseUrl)
  const controlSignal = timedSignal(signal ?? new AbortController().signal, CONTROL_TIMEOUT_MS)
  const { response, text } = await fetchJson(url, { method: "DELETE", headers: { Accept: "application/json" } }, controlSignal)
  if (response.status === 404) throw mapHttpStatusToError(404, text)
  if (!response.ok) throw mapHttpStatusToError(response.status, text)
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed) && parsed.status === "CANCELED") {
      return getShrinkcordJob(jobId, signal, baseUrl)
    }
  } catch {
    // fall through to full job fetch
  }
  return getShrinkcordJob(jobId, signal, baseUrl)
}

export async function downloadShrinkcordJobFile(
  jobId: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<Blob> {
  const url = shrinkcordApiUrl(`/jobs/${encodeURIComponent(jobId)}/file`, baseUrl)
  const downloadSignal = timedSignal(signal ?? new AbortController().signal, 10 * 60 * 1000)
  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "video/mp4, application/octet-stream" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: downloadSignal,
    })
  } catch {
    if (signal?.aborted) throw abortError()
    throw new ShrinkcordApiError("network", "The video download connection failed.", { retryable: true })
  }
  if (!response.ok) throw mapHttpStatusToError(response.status, await response.text().catch(() => ""))
  const blob = await response.blob()
  if (!blob.size) throw new ShrinkcordApiError("corrupt", "Shrinkcord returned an empty video file.", { retryable: false })
  return blob
}

export const browserShrinkcordApiTransport: ShrinkcordApiTransport = {
  uploadJob: uploadShrinkcordJob,
  getJob: getShrinkcordJob,
  cancelJob: cancelShrinkcordJob,
  downloadJobFile: downloadShrinkcordJobFile,
}
