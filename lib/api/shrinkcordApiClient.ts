import { getShrinkcordApiBaseUrl, shrinkcordApiUrl } from "@/lib/api/shrinkcordApiUrl"
import { resolveShrinkcordStorageUrl } from "@/lib/storage/shrinkcordStorageUrl"
import { normalizeCompressProgress } from "@/lib/video/videoProgress"

export type ShrinkcordJobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELED"

export type ShrinkcordJob = {
  id: string
  status: ShrinkcordJobStatus
  progress: number
  target_size_bytes: number | null
  source_bytes: number | null
  output_bytes: number | null
  error_message: string | null
  key?: string | null
  download_url?: string | null
  expires_at?: string | null
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
  readonly retryAfterMs?: number
  readonly retriesExhausted?: boolean

  constructor(
    code: ShrinkcordApiErrorCode,
    message: string,
    options: {
      status?: number
      retryable?: boolean
      retryAfterMs?: number
      retriesExhausted?: boolean
    } = {},
  ) {
    super(message)
    this.name = "ShrinkcordApiError"
    this.code = code
    this.status = options.status
    this.retryable = options.retryable ?? false
    this.retryAfterMs = options.retryAfterMs
    this.retriesExhausted = options.retriesExhausted ?? false
  }
}

export type UploadJobOptions = {
  file: File
  targetSizeBytes?: number
  signal?: AbortSignal
  baseUrl?: string
  onUploadProgress?: (loaded: number, total: number) => void
  onRateLimited?: (retryAfterMs: number, attempt: number) => void
  maxRateLimitRetries?: number
  uploadImpl?: typeof uploadJobWithXhr
  /** When set, skip re-uploading if a job id was already created. */
  existingJobId?: string
}

export type DownloadJobFileOptions = {
  signal?: AbortSignal
  baseUrl?: string
  downloadUrl?: string
  onProgress?: (loaded: number, total: number | null) => void
}

export const MAX_VIDEO_OUTPUT_BYTES = 500 * 1024 * 1024

export type ShrinkcordApiTransport = {
  uploadJob(options: UploadJobOptions): Promise<{ id: string }>
  getJob(jobId: string, signal?: AbortSignal, baseUrl?: string): Promise<ShrinkcordJob>
  cancelJob(jobId: string, signal?: AbortSignal, baseUrl?: string): Promise<ShrinkcordJob | null>
  downloadJobFile(jobId: string, options?: DownloadJobFileOptions): Promise<Blob>
}

const CONTROL_TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000
const DEFAULT_RATE_LIMIT_DELAY_MS = 5_000
const DEFAULT_RATE_LIMIT_RETRIES = 12
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseRetryAfterMs(headerValue: string | null): number {
  if (!headerValue?.trim()) return DEFAULT_RATE_LIMIT_DELAY_MS
  const trimmed = headerValue.trim()
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(0, Math.round(seconds * 1000))
  const date = Date.parse(trimmed)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return DEFAULT_RATE_LIMIT_DELAY_MS
}

export function mapHttpStatusToError(
  status: number,
  bodyText: string,
  retryAfterMs?: number,
): ShrinkcordApiError {
  if (status === 413) {
    return new ShrinkcordApiError(
      "too_large",
      "Choose a video that is 524.288 MiB (500 MiB) or smaller.",
      { status },
    )
  }
  if (status === 415) {
    return new ShrinkcordApiError(
      "unsupported",
      "Choose an MP4 or iPhone MOV video file.",
      { status },
    )
  }
  if (status === 429) {
    return new ShrinkcordApiError(
      "server_busy",
      "Server busy, retrying.",
      { status, retryable: true, retryAfterMs },
    )
  }
  if (status === 400) return map400Error(bodyText)
  if (status === 404) {
    return new ShrinkcordApiError(
      "unknown",
      "This video job could not be found.",
      { status, retryable: false },
    )
  }
  if (status === 409) {
    return new ShrinkcordApiError(
      "unknown",
      "This job already finished.",
      { status, retryable: false },
    )
  }
  if (status >= 500) {
    return new ShrinkcordApiError(
      "unknown",
      "Shrinkcord had a server error. Try again.",
      { status, retryable: true },
    )
  }
  return new ShrinkcordApiError(
    "unknown",
    "Could not complete this request. Try again.",
    { status, retryable: status === 408 },
  )
}

function map400Error(bodyText: string): ShrinkcordApiError {
  const lower = extractErrorMessage(bodyText).toLowerCase()
  if (lower.includes("duration") || lower.includes("longer than") || lower.includes("601")) {
    return new ShrinkcordApiError(
      "too_long",
      "Choose a video that is 10 minutes or shorter.",
      { status: 400 },
    )
  }
  if (lower.includes("target") && (lower.includes("size") || lower.includes("bitrate"))) {
    return new ShrinkcordApiError(
      "corrupt",
      "Target size is too small for this video.",
      { status: 400 },
    )
  }
  if (lower.includes("uuid") || lower.includes("validation failed")) {
    return new ShrinkcordApiError(
      "unknown",
      "This video job ID is invalid.",
      { status: 400 },
    )
  }
  if (lower.includes("corrupt") || lower.includes("probe") || lower.includes("invalid video")) {
    return new ShrinkcordApiError(
      "corrupt",
      "This video could not be read. Try another file.",
      { status: 400 },
    )
  }
  return new ShrinkcordApiError(
    "corrupt",
    "This video could not be accepted.",
    { status: 400 },
  )
}

/** Nest: { message, error, statusCode }. Legacy API: { message, status }. HTTP status is mapped separately. */
export function extractErrorMessage(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      const fromMessage = readApiErrorTextField(record.message)
      if (fromMessage) return fromMessage.slice(0, 240)
      const fromDetail = readApiErrorTextField(record.detail)
      if (fromDetail) return fromDetail.slice(0, 240)
      const fromError = readApiErrorTextField(record.error)
      if (fromError) return fromError.slice(0, 240)
    }
  } catch {
    // ignore
  }
  return bodyText.trim().slice(0, 240)
}

function readApiErrorTextField(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")) {
    return value.join(" ").trim()
  }
  return null
}

function parseProgress(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(100, Math.max(0, Math.round(value)))
  }
  return 0
}

function parseJob(value: unknown, expectedId?: string, baseUrl?: string): ShrinkcordJob {
  if (!isRecord(value) || typeof value.id !== "string" || !UUID_V4.test(value.id)) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned an invalid job response.", { retryable: true })
  }
  if (expectedId && value.id.toLowerCase() !== expectedId.toLowerCase()) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned a mismatched job ID.", { retryable: false })
  }
  if (!isJobStatus(value.status) || value.progress === undefined || value.progress === null) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned an invalid job response.", { retryable: true })
  }

  const status = value.status
  const progress = normalizeCompressProgress(status, parseProgress(value.progress))

  return {
    id: value.id,
    status,
    progress,
    target_size_bytes: optionalInt(value.target_size_bytes),
    source_bytes: optionalInt(value.source_bytes),
    output_bytes: optionalInt(value.output_bytes),
    error_message: optionalString(value.error_message),
    key: optionalStorageKey(value.key),
    download_url: optionalHttpUrl(value.download_url, baseUrl ?? getShrinkcordApiBaseUrl()),
    expires_at: optionalIsoDateTime(value.expires_at),
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

function optionalStorageKey(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 2048 ? trimmed : null
}

function optionalIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : null
}

function optionalHttpUrl(value: unknown, apiBaseUrl: string): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const resolved = resolveShrinkcordStorageUrl(trimmed, apiBaseUrl)
  try {
    const parsed = new URL(resolved)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return resolved
  } catch {
    return null
  }
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
): Promise<{ id: string; retryAfterMs?: number }> {
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
        const retryAfterMs = parseRetryAfterMs(request.getResponseHeader("Retry-After"))
        finish(mapHttpStatusToError(429, body, retryAfterMs))
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
  if (options.existingJobId) return { id: options.existingJobId }

  const baseUrl = options.baseUrl ?? getShrinkcordApiBaseUrl()
  const url = shrinkcordApiUrl("/jobs", baseUrl)
  const targetSizeBytes = options.targetSizeBytes ?? 20_000_000
  const signal = options.signal ?? new AbortController().signal
  const maxRetries = options.maxRateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES
  const uploadImpl = options.uploadImpl ?? uploadJobWithXhr

  let rateLimitAttempts = 0
  while (true) {
    try {
      const result = await uploadImpl(
        url,
        options.file,
        targetSizeBytes,
        timedSignal(signal, UPLOAD_TIMEOUT_MS),
        options.onUploadProgress,
      )
      return { id: result.id }
    } catch (error) {
      if (signal.aborted) throw abortError()
      if (error instanceof ShrinkcordApiError && error.status === 429) {
        const delayMs = error.retryAfterMs ?? DEFAULT_RATE_LIMIT_DELAY_MS
        if (rateLimitAttempts < maxRetries) {
          rateLimitAttempts += 1
          options.onRateLimited?.(delayMs, rateLimitAttempts)
          await waitMs(delayMs, signal)
          continue
        }
        throw new ShrinkcordApiError(
          "server_busy",
          "Server is busy. Try again in a moment.",
          { status: 429, retryable: false, retriesExhausted: true },
        )
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
  if (!response.ok) throw mapHttpStatusToError(response.status, text, parseRetryAfterMs(response.headers.get("Retry-After")))
  return parseJob(JSON.parse(text), jobId, baseUrl)
}

export async function cancelShrinkcordJob(
  jobId: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<ShrinkcordJob | null> {
  if (!UUID_V4.test(jobId)) {
    throw new ShrinkcordApiError("unknown", "This video job ID is invalid.", { retryable: false })
  }
  const url = shrinkcordApiUrl(`/jobs/${encodeURIComponent(jobId)}`, baseUrl)
  const controlSignal = timedSignal(signal ?? new AbortController().signal, CONTROL_TIMEOUT_MS)
  const { response, text } = await fetchJson(url, { method: "DELETE", headers: { Accept: "application/json" } }, controlSignal)
  if (response.status === 409) {
    try {
      return await getShrinkcordJob(jobId, signal, baseUrl)
    } catch {
      return null
    }
  }
  if (response.status === 404) throw mapHttpStatusToError(404, text)
  if (!response.ok) throw mapHttpStatusToError(response.status, text)
  try {
    return await getShrinkcordJob(jobId, signal, baseUrl)
  } catch {
    return null
  }
}

export async function downloadShrinkcordJobFile(
  jobId: string,
  options: DownloadJobFileOptions = {},
): Promise<Blob> {
  const baseUrl = options.baseUrl ?? getShrinkcordApiBaseUrl()
  const url = options.downloadUrl ?? shrinkcordApiUrl(`/jobs/${encodeURIComponent(jobId)}/file`, baseUrl)
  const downloadSignal = timedSignal(options.signal ?? new AbortController().signal, 10 * 60 * 1000)
  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "video/mp4, application/octet-stream" },
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: downloadSignal,
    })
  } catch {
    if (options.signal?.aborted) throw abortError()
    if (downloadSignal.aborted) {
      throw new ShrinkcordApiError("network", "The video download timed out. Try again.", { retryable: true })
    }
    throw new ShrinkcordApiError("network", "The video download connection failed.", { retryable: true })
  }
  if (!response.ok) {
    throw mapHttpStatusToError(response.status, await response.text().catch(() => ""))
  }
  const lengthHeader = response.headers.get("content-length")
  const total = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null
  if (total !== null && total > MAX_VIDEO_OUTPUT_BYTES) {
    void response.body?.cancel().catch(() => {})
    throw new ShrinkcordApiError("too_large", "The video exceeds the 500 MiB download limit.", {
      status: 413,
      retryable: false,
    })
  }
  if (!response.body) {
    throw new ShrinkcordApiError("corrupt", "Shrinkcord returned an empty video file.", { retryable: false })
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  options.onProgress?.(0, total)

  try {
    while (true) {
      if (downloadSignal.aborted) throw abortError()
      const { done, value } = await readWithSignal(reader, downloadSignal)
      if (done) break
      if (!value?.byteLength) continue
      loaded += value.byteLength
      if (loaded > MAX_VIDEO_OUTPUT_BYTES) {
        void reader.cancel().catch(() => {})
        throw new ShrinkcordApiError("too_large", "The video exceeds the 500 MiB download limit.", {
          status: 413,
          retryable: false,
        })
      }
      chunks.push(value)
      options.onProgress?.(loaded, total)
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    if (options.signal?.aborted) throw abortError()
    if (downloadSignal.aborted) {
      throw new ShrinkcordApiError("network", "The video download timed out. Try again.", { retryable: true })
    }
    if (error instanceof ShrinkcordApiError) throw error
    throw new ShrinkcordApiError("network", "The video download connection failed.", { retryable: true })
  } finally {
    reader.releaseLock()
  }

  if (loaded === 0) {
    throw new ShrinkcordApiError("corrupt", "Shrinkcord returned an empty video file.", { retryable: false })
  }
  const blob = new Blob(chunks as BlobPart[], { type: "video/mp4" })
  return blob
}

function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      void reader.cancel().catch(() => {})
      reject(abortError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
    reader.read().then(
      (result) => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", onAbort)
        resolve(result)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
    if (signal.aborted) onAbort()
  })
}

export const browserShrinkcordApiTransport: ShrinkcordApiTransport = {
  uploadJob: uploadShrinkcordJob,
  getJob: getShrinkcordJob,
  cancelJob: cancelShrinkcordJob,
  downloadJobFile: (jobId, options) => downloadShrinkcordJobFile(jobId, options),
}
