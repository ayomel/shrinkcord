export const MAX_VIDEO_OUTPUT_BYTES = 500 * 1024 * 1024

const CONTROL_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export class VideoOutputError extends Error {
  readonly status?: number
  readonly expired: boolean
  readonly retryable: boolean

  constructor(message: string, options: { status?: number; expired?: boolean; retryable?: boolean } = {}) {
    super(message)
    this.name = "VideoOutputError"
    this.status = options.status
    this.expired = options.expired ?? false
    this.retryable = options.retryable ?? (
      options.status === undefined || options.status >= 500 || options.status === 408 ||
      options.status === 429 || options.status === 401 || options.status === 403
    )
  }
}

export type FetchVideoJobOutputOptions = {
  signal?: AbortSignal
  fetcher?: typeof fetch
  /** Optional origin for controlled simulations and tests. */
  apiBaseUrl?: string
}

export type VideoJobOutput = { blob: Blob; bytes: number }

export async function fetchVideoJobOutput(
  jobId: string,
  options: FetchVideoJobOutputOptions = {},
): Promise<VideoJobOutput> {
  const fetcher = options.fetcher ?? fetch
  const path = `/api/jobs/${encodeURIComponent(jobId)}/download`
  const apiUrl = options.apiBaseUrl ? new URL(path, options.apiBaseUrl).toString() : path
  const outputUrl = await getSignedOutputUrl(apiUrl, fetcher, options.signal)

  try {
    return await downloadOutput(outputUrl, fetcher, options.signal)
  } catch (error) {
    if (!(error instanceof VideoOutputError) || (error.status !== 401 && error.status !== 403)) throw error
  }

  // A signed URL can expire between issuing it and the browser following it. Refresh once only.
  const refreshedUrl = await getSignedOutputUrl(apiUrl, fetcher, options.signal)
  return downloadOutput(refreshedUrl, fetcher, options.signal)
}

export function getVideoOutputFileName(inputFileName: string): string {
  const baseName = inputFileName.split(/[\\/]/).pop()?.trim() || "video"
  const stem = baseName.replace(/\.[^.]+$/, "") || "video"
  return `${stem}-discord.mp4`
}

async function getSignedOutputUrl(apiUrl: string, fetcher: typeof fetch, callerSignal?: AbortSignal): Promise<string> {
  const signal = timedSignal(callerSignal, CONTROL_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetcher(apiUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    })
  } catch (error) {
    throw requestError(error, callerSignal, "Could not reach Shrinkcord. Check your connection and try again.")
  }

  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined)
    throw new VideoOutputError("This video job could not be found.", { status: 404, retryable: false })
  }
  if (response.status === 409) {
    await response.body?.cancel().catch(() => undefined)
    throw new VideoOutputError("Your video is still being processed. Try again shortly.", { status: 409, retryable: true })
  }
  if (response.status === 410) {
    await response.body?.cancel().catch(() => undefined)
    throw new VideoOutputError("This video's output has expired. Submit the video again to create a new output.", { status: 410, expired: true, retryable: false })
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw httpError(response.status, "Shrinkcord could not prepare this video for download.")
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (signal.aborted) throw requestError(signal.reason, callerSignal, "Shrinkcord took too long to prepare the download.")
    throw new VideoOutputError("Shrinkcord returned an invalid download response.", { retryable: true })
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || typeof (body as Record<string, unknown>).url !== "string") {
    throw new VideoOutputError("Shrinkcord returned an invalid download response.", { retryable: true })
  }
  return parseSafeOutputUrl((body as { url: string }).url)
}

function parseSafeOutputUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new VideoOutputError("Shrinkcord returned an invalid output URL.", { retryable: true })
  }
  const localHttp = url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname.toLowerCase())
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.hash) {
    throw new VideoOutputError("Shrinkcord returned an unsafe output URL.", { retryable: false })
  }
  // Preserve the signed URL byte-for-byte after validation; canonicalization can invalidate signatures.
  return value
}

async function downloadOutput(url: string, fetcher: typeof fetch, callerSignal?: AbortSignal): Promise<VideoJobOutput> {
  const signal = timedSignal(callerSignal, DOWNLOAD_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "video/mp4, application/octet-stream" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    })
  } catch (error) {
    throw requestError(error, callerSignal, "The video download connection failed. Check your connection and try again.")
  }

  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined)
    throw httpError(response.status, "The temporary download link expired.")
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw httpError(response.status, "The video download failed.")
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "video/mp4" && contentType !== "application/octet-stream") {
    await response.body?.cancel().catch(() => undefined)
    throw new VideoOutputError("Shrinkcord returned a file that is not an MP4 video.", { status: response.status, retryable: false })
  }
  const declaredLength = response.headers.get("content-length")
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_VIDEO_OUTPUT_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw tooLargeError()
  }
  if (!response.body) throw new VideoOutputError("Shrinkcord returned an empty video file.", { retryable: false })

  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let bytes = 0
  const prefix: number[] = []
  const cancelReader = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener("abort", cancelReader, { once: true })
  try {
    while (true) {
      if (signal.aborted) throw requestError(signal.reason, callerSignal, "The video download took too long.")
      const { done, value } = await reader.read()
      if (signal.aborted) throw requestError(signal.reason, callerSignal, "The video download took too long.")
      if (done) break
      if (!value?.byteLength) continue
      bytes += value.byteLength
      if (bytes > MAX_VIDEO_OUTPUT_BYTES) throw tooLargeError()
      if (value.buffer instanceof ArrayBuffer && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
        chunks.push(value.buffer)
      } else {
        const copy = new ArrayBuffer(value.byteLength)
        new Uint8Array(copy).set(value)
        chunks.push(copy)
      }
      for (let i = 0; i < value.length && prefix.length < 512; i += 1) prefix.push(value[i]!)
      if (looksLikeHtml(prefix)) {
        throw new VideoOutputError("Shrinkcord returned an error page instead of an MP4 video.", { retryable: false })
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (signal.aborted) throw requestError(signal.reason, callerSignal, "The video download took too long.")
    if (error instanceof VideoOutputError) throw error
    throw new VideoOutputError("The video download was interrupted. Try again.", { retryable: true })
  } finally {
    signal.removeEventListener("abort", cancelReader)
    reader.releaseLock()
  }

  if (bytes === 0) throw new VideoOutputError("Shrinkcord returned an empty video file.", { retryable: false })
  const blob = new Blob(chunks, { type: "video/mp4" })
  if (blob.size !== bytes) throw new VideoOutputError("Shrinkcord returned an incomplete video file.", { retryable: true })
  return { blob, bytes }
}

function looksLikeHtml(bytes: number[]): boolean {
  const prefix = new TextDecoder().decode(new Uint8Array(bytes)).trimStart().slice(0, 80).toLowerCase()
  return /^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/.test(prefix)
}

function timedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function requestError(error: unknown, callerSignal: AbortSignal | undefined, fallbackMessage: string): Error {
  if (callerSignal?.aborted) return new DOMException("The request was canceled.", "AbortError")
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new VideoOutputError("The request took too long. Check your connection and try again.", { retryable: true })
  }
  return new VideoOutputError(fallbackMessage, { retryable: true })
}

function httpError(status: number, message: string): VideoOutputError {
  return new VideoOutputError(`${message} (HTTP ${status}).`, { status })
}

function tooLargeError(): VideoOutputError {
  return new VideoOutputError("The video exceeds the 500 MiB download limit.", { status: 413, retryable: false })
}
