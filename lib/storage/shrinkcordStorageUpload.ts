import { ShrinkcordApiError } from "@/lib/api/shrinkcordApiClient"
import { getShrinkcordApiBaseUrl, isShrinkcordCloudStorageConfigured, shrinkcordApiUrl } from "@/lib/api/shrinkcordApiUrl"
import { resolveShrinkcordStorageUrl } from "@/lib/storage/shrinkcordStorageUrl"

export type ShrinkcordUploadSession = {
  key: string
  upload_url: string
  method: "PUT"
  headers: Record<string, string>
  download_url: string
  expires_at: string
}

export type StorageUploadSuccess = {
  ok: true
  key: string
  downloadUrl: string
  expiresAt: string
}

export type StorageUploadFailure = {
  ok: false
  reason: "not_configured" | "collision_exhausted" | "network" | "rejected"
}

export type StorageUploadResult = StorageUploadSuccess | StorageUploadFailure

export type UploadCompressedBlobOptions = {
  blob: Blob
  fileName: string
  contentType: string
  signal?: AbortSignal
  baseUrl?: string
  maxCollisionAttempts?: number
  postTimeoutMs?: number
  onProgress?: (percent: number) => void
  fetchImpl?: typeof fetch
  putImpl?: typeof putBlobWithXhr
  createSessionImpl?: typeof createShrinkcordUploadSession
}

const DEFAULT_COLLISION_ATTEMPTS = 5
export const POST_UPLOAD_TIMEOUT_MS = 15_000
const PUT_TIMEOUT_MIN_MS = 60_000
const PUT_TIMEOUT_MAX_MS = 30 * 60 * 1000

export class StorageTimeoutError extends Error {
  constructor(message = "The online save timed out.") {
    super(message)
    this.name = "StorageTimeoutError"
  }
}

export function isStorageUserAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function userAbortError(): DOMException {
  return new DOMException("The request was canceled.", "AbortError")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function timedSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return AbortSignal.any([signal, timeout])
}

function throwIfAborted(userSignal: AbortSignal, controlSignal: AbortSignal): void {
  if (userSignal.aborted) throw userAbortError()
  if (controlSignal.aborted) throw new StorageTimeoutError()
}

export function putUploadTimeoutMs(byteLength: number): number {
  const mebibytes = byteLength / (1024 * 1024)
  const scaled = 15_000 + Math.ceil(mebibytes) * 2_000
  return Math.min(PUT_TIMEOUT_MAX_MS, Math.max(PUT_TIMEOUT_MIN_MS, scaled))
}

function parseAbsoluteHttpUrl(value: string, apiBaseUrl: string, fieldName: string): string {
  const resolved = resolveShrinkcordStorageUrl(value, apiBaseUrl)
  try {
    const parsed = new URL(resolved)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid protocol")
    }
    return resolved
  } catch {
    throw new ShrinkcordApiError("unknown", `Shrinkcord returned an invalid ${fieldName}.`, { retryable: true })
  }
}

function parseUploadSession(value: unknown, apiBaseUrl: string): ShrinkcordUploadSession {
  if (!isRecord(value)) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned an invalid upload response.", { retryable: true })
  }
  const method = value.method
  const key = value.key
  const uploadUrl = value.upload_url
  const downloadUrl = value.download_url
  const expiresAt = value.expires_at
  const headers = value.headers
  if (
    method !== "PUT"
    || typeof key !== "string"
    || !key.trim()
    || typeof uploadUrl !== "string"
    || typeof downloadUrl !== "string"
    || typeof expiresAt !== "string"
    || !expiresAt.trim()
    || !isRecord(headers)
  ) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned an invalid upload response.", { retryable: true })
  }
  const normalizedHeaders: Record<string, string> = {}
  for (const [header, headerValue] of Object.entries(headers)) {
    if (typeof headerValue === "string") normalizedHeaders[header] = headerValue
  }
  if (!normalizedHeaders["Content-Type"]) {
    throw new ShrinkcordApiError("unknown", "Shrinkcord returned an invalid upload response.", { retryable: true })
  }
  return {
    key: key.trim(),
    upload_url: parseAbsoluteHttpUrl(uploadUrl, apiBaseUrl, "upload URL"),
    method: "PUT",
    headers: normalizedHeaders,
    download_url: parseAbsoluteHttpUrl(downloadUrl, apiBaseUrl, "download URL"),
    expires_at: expiresAt.trim(),
  }
}

export type CreateUploadSessionInput = {
  filename: string
  content_type: string
  size: number
  previous_key?: string
}

export async function createShrinkcordUploadSession(
  input: CreateUploadSessionInput,
  options: {
    baseUrl?: string
    signal?: AbortSignal
    fetchImpl?: typeof fetch
    postTimeoutMs?: number
  } = {},
): Promise<ShrinkcordUploadSession> {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl ?? getShrinkcordApiBaseUrl()
  const url = shrinkcordApiUrl("/uploads", baseUrl)
  const userSignal = options.signal ?? new AbortController().signal
  const postTimeoutMs = options.postTimeoutMs ?? POST_UPLOAD_TIMEOUT_MS
  const controlSignal = timedSignal(userSignal, postTimeoutMs)
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: input.filename,
        content_type: input.content_type,
        size: input.size,
        ...(input.previous_key ? { previous_key: input.previous_key } : {}),
      }),
      cache: "no-store",
      credentials: "omit",
      signal: controlSignal,
    })
  } catch {
    throwIfAborted(userSignal, controlSignal)
    throw new ShrinkcordApiError("network", "Could not reach Shrinkcord. Check your connection and try again.", { retryable: true })
  }
  const text = await response.text()
  if (response.status === 413) {
    throw new ShrinkcordApiError("too_large", "This compressed image is too large to store online.", { status: 413 })
  }
  if (response.status !== 201) {
    throw new ShrinkcordApiError(
      "unknown",
      "Could not start the online save.",
      { status: response.status, retryable: response.status >= 500 },
    )
  }
  return parseUploadSession(JSON.parse(text), baseUrl)
}

export function putBlobWithXhr(
  uploadUrl: string,
  blob: Blob,
  headers: Record<string, string>,
  signal: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    let settled = false
    const finish = (error?: Error, status?: number) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else resolve(status ?? 0)
    }
    const onAbort = () => {
      request.abort()
      finish(userAbortError())
    }

    request.open("PUT", uploadUrl)
    request.timeout = putUploadTimeoutMs(blob.size)
    request.withCredentials = false
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value)
    }
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    })
    request.addEventListener("load", () => finish(undefined, request.status))
    request.addEventListener("error", () => {
      finish(new ShrinkcordApiError("network", "The upload connection failed.", { retryable: true }))
    })
    request.addEventListener("timeout", () => {
      finish(new StorageTimeoutError())
    })
    request.addEventListener("abort", () => finish(userAbortError()))
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    request.send(blob)
  })
}

export async function uploadCompressedBlobToStorage(
  options: UploadCompressedBlobOptions,
): Promise<StorageUploadResult> {
  if (!isShrinkcordCloudStorageConfigured()) {
    return { ok: false, reason: "not_configured" }
  }

  const signal = options.signal ?? new AbortController().signal
  const baseUrl = options.baseUrl ?? getShrinkcordApiBaseUrl()
  const maxAttempts = options.maxCollisionAttempts ?? DEFAULT_COLLISION_ATTEMPTS
  const fetchImpl = options.fetchImpl ?? fetch
  const putImpl = options.putImpl ?? putBlobWithXhr
  const createSessionImpl = options.createSessionImpl ?? createShrinkcordUploadSession
  const postTimeoutMs = options.postTimeoutMs

  let previousKey: string | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) throw userAbortError()
    try {
      const session = await createSessionImpl(
        {
          filename: options.fileName,
          content_type: options.contentType,
          size: options.blob.size,
          previous_key: previousKey,
        },
        { baseUrl, signal, fetchImpl, postTimeoutMs },
      )
      const status = await putImpl(
        session.upload_url,
        options.blob,
        session.headers,
        signal,
        (loaded, total) => {
          if (!total) return
          options.onProgress?.(Math.min(99, Math.round((loaded / total) * 100)))
        },
      )
      if (status === 412) {
        previousKey = session.key
        continue
      }
      if (status >= 200 && status < 300) {
        options.onProgress?.(100)
        return {
          ok: true,
          key: session.key,
          downloadUrl: session.download_url,
          expiresAt: session.expires_at,
        }
      }
      return { ok: false, reason: "rejected" }
    } catch (error) {
      if (isStorageUserAbort(error)) throw error
      if (error instanceof StorageTimeoutError) {
        return { ok: false, reason: "network" }
      }
      if (error instanceof ShrinkcordApiError && error.code === "too_large") {
        return { ok: false, reason: "rejected" }
      }
      return { ok: false, reason: "network" }
    }
  }
  return { ok: false, reason: "collision_exhausted" }
}
