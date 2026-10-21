import { getShrinkcordApiBaseUrl, isShrinkcordCloudStorageConfigured, shrinkcordApiUrl } from "@/lib/shrinkcord-api-url"
import { ShrinkcordApiError } from "@/lib/shrinkcord-api-client"

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
  onProgress?: (percent: number) => void
  fetchImpl?: typeof fetch
  putImpl?: typeof putBlobWithXhr
  createSessionImpl?: typeof createShrinkcordUploadSession
}

const DEFAULT_COLLISION_ATTEMPTS = 3

function abortError(): DOMException {
  return new DOMException("The request was canceled.", "AbortError")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseUploadSession(value: unknown): ShrinkcordUploadSession {
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
    || typeof uploadUrl !== "string"
    || typeof downloadUrl !== "string"
    || typeof expiresAt !== "string"
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
    key,
    upload_url: uploadUrl,
    method: "PUT",
    headers: normalizedHeaders,
    download_url: downloadUrl,
    expires_at: expiresAt,
  }
}

export async function createShrinkcordUploadSession(
  input: { filename: string; contentType: string; size: number },
  options: { baseUrl?: string; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ShrinkcordUploadSession> {
  const fetchImpl = options.fetchImpl ?? fetch
  const url = shrinkcordApiUrl("/uploads", options.baseUrl ?? getShrinkcordApiBaseUrl())
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
        contentType: input.contentType,
        size: input.size,
      }),
      cache: "no-store",
      credentials: "omit",
      signal: options.signal,
    })
  } catch {
    if (options.signal?.aborted) throw abortError()
    throw new ShrinkcordApiError("network", "Could not reach Shrinkcord. Check your connection and try again.", { retryable: true })
  }
  const text = await response.text()
  if (!response.ok) {
    throw new ShrinkcordApiError(
      response.status === 413 ? "too_large" : "unknown",
      response.status === 413
        ? "This compressed image is too large to store online."
        : "Could not start the online save.",
      { status: response.status, retryable: response.status >= 500 },
    )
  }
  return parseUploadSession(JSON.parse(text))
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
      finish(abortError())
    }

    request.open("PUT", uploadUrl)
    request.timeout = 30 * 60 * 1000
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
      finish(new ShrinkcordApiError("network", "The upload took too long.", { retryable: true }))
    })
    request.addEventListener("abort", () => finish(abortError()))
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

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) throw abortError()
    try {
      const session = await createSessionImpl(
        {
          filename: options.fileName,
          contentType: options.contentType,
          size: options.blob.size,
        },
        { baseUrl, signal, fetchImpl },
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
      if (status === 412) continue
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
      if (error instanceof DOMException && error.name === "AbortError") throw error
      if (error instanceof ShrinkcordApiError && error.code === "too_large") {
        return { ok: false, reason: "rejected" }
      }
      return { ok: false, reason: "network" }
    }
  }
  return { ok: false, reason: "collision_exhausted" }
}
