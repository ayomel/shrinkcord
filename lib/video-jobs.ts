export type VideoJobPhase = "uploading" | "submitting" | "queued"

export type VideoJobAttempt = {
  file: File
  targetSizeBytes: number
  idempotencyKey: string
  inputKey?: string
  jobId?: string
  inFlight?: boolean
}

export type VideoJobTransport = {
  createUpload(contentLength: number, signal: AbortSignal): Promise<unknown>
  uploadFile(
    uploadUrl: string,
    file: File,
    signal: AbortSignal,
    onProgress: (loaded: number, total: number) => void,
  ): Promise<void>
  createJob(
    input: { input_key: string; target_size_bytes: number; idempotencyKey: string },
    signal: AbortSignal,
  ): Promise<unknown>
}

type SubmitVideoJobOptions = {
  file: File
  targetSizeBytes: number
  attempt: VideoJobAttempt
  signal?: AbortSignal
  transport?: VideoJobTransport
  onPhase?: (phase: VideoJobPhase) => void
  onProgress?: (percent: number) => void
}

const CONTROL_TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_INPUT_KEY = /^[A-Za-z0-9][A-Za-z0-9/_\-.]{0,1023}$/

export function createVideoJobAttempt(
  file: File,
  targetSizeBytes: number,
  makeIdempotencyKey: () => string = () => `video-job:${crypto.randomUUID()}`,
): VideoJobAttempt {
  return { file, targetSizeBytes, idempotencyKey: makeIdempotencyKey() }
}

export async function submitVideoJob(options: SubmitVideoJobOptions): Promise<{ jobId: string }> {
  const { file, targetSizeBytes, attempt } = options
  if (attempt.file !== file || attempt.targetSizeBytes !== targetSizeBytes) {
    throw new Error("The selected video or target size changed. Start a new submission.")
  }
  if (attempt.jobId) return { jobId: attempt.jobId }
  if (attempt.inFlight) throw new Error("This video is already being submitted.")
  if (options.signal?.aborted) throw abortError()

  attempt.inFlight = true
  const transport = options.transport ?? browserVideoJobTransport
  try {
    if (!attempt.inputKey) {
      options.onPhase?.("uploading")
      const reservation = parseUploadReservation(await transport.createUpload(file.size, requiredSignal(options.signal)))
      await transport.uploadFile(reservation.uploadUrl, file, requiredSignal(options.signal), (loaded, total) => {
        if (total > 0) options.onProgress?.(Math.min(99, Math.max(0, Math.round((loaded / total) * 100))))
      })
      attempt.inputKey = reservation.key
      options.onProgress?.(100)
    }

    options.onPhase?.("submitting")
    const response = parseCreatedJob(await transport.createJob({
      input_key: attempt.inputKey,
      target_size_bytes: targetSizeBytes,
      idempotencyKey: attempt.idempotencyKey,
    }, requiredSignal(options.signal)))
    attempt.jobId = response.jobId
    options.onPhase?.("queued")
    return { jobId: response.jobId }
  } finally {
    attempt.inFlight = false
  }
}

function parseUploadReservation(value: unknown): { uploadUrl: string; key: string } {
  if (!isRecord(value) || typeof value.upload_url !== "string" || typeof value.key !== "string") {
    throw new Error("The upload service returned an invalid response. Try again.")
  }

  let url: URL
  try {
    url = new URL(value.upload_url)
  } catch {
    throw new Error("The upload service returned an invalid upload URL. Try again.")
  }
  const localHttpHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && localHttpHost)) || url.username || url.password || url.hash) {
    throw new Error("The upload service returned an unsafe upload URL. Try again.")
  }
  if (!SAFE_INPUT_KEY.test(value.key) || value.key.includes("..")) {
    throw new Error("The upload service returned an invalid file key. Try again.")
  }
  return { uploadUrl: value.upload_url, key: value.key }
}

function parseCreatedJob(value: unknown): { jobId: string } {
  if (!isRecord(value) || typeof value.jobId !== "string" || !UUID_V4.test(value.jobId)) {
    throw new Error("The job service returned an invalid response. Try again.")
  }
  return { jobId: value.jobId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? new AbortController().signal
}

function abortError() {
  return new DOMException("The request was canceled.", "AbortError")
}

function timedSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return AbortSignal.any([signal, timeoutSignal])
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (isRecord(body)) {
      for (const field of ["message", "detail", "error"]) {
        const value = body[field]
        if (typeof value === "string" && value.trim()) return value.slice(0, 240)
        if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
          return value.join(" ").slice(0, 240)
        }
      }
    }
  } catch {
    // Do not surface untrusted HTML or malformed error bodies.
  }
  return `Request failed (HTTP ${response.status}). Try again.`
}

async function postJson(path: string, body: unknown, signal: AbortSignal, idempotencyKey?: string): Promise<unknown> {
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" })
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey)
  let response: Response
  try {
    response = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: timedSignal(signal, CONTROL_TIMEOUT_MS),
    })
  } catch (error) {
    if (signal.aborted) throw abortError()
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("The request took too long. Check your connection and try again.")
    }
    throw new Error("Could not reach Shrinkcord. Check your connection and try again.")
  }
  if (!response.ok) throw new Error(await readApiError(response))
  try {
    return await response.json()
  } catch {
    throw new Error("Shrinkcord returned an invalid response. Try again.")
  }
}

function putFile(uploadUrl: string, file: File, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () => {
      request.abort()
      finish(abortError())
    }

    request.open("PUT", uploadUrl)
    request.timeout = UPLOAD_TIMEOUT_MS
    request.withCredentials = false
    request.setRequestHeader("Content-Type", "video/mp4")
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    })
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) finish()
      else if (request.status === 0) finish(new Error("The upload connection closed before it finished. Try again."))
      else finish(new Error(request.status === 403
        ? "Storage rejected the upload. Check the bucket CORS and signed URL settings."
        : `Upload failed (HTTP ${request.status}). Try again.`))
    })
    request.addEventListener("error", () => finish(new Error("The upload connection failed. Check your connection and try again.")))
    request.addEventListener("timeout", () => finish(new Error("The upload took too long. Check your connection and try again.")))
    request.addEventListener("abort", () => finish(abortError()))
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    request.send(file)
  })
}

const browserVideoJobTransport: VideoJobTransport = {
  createUpload: (contentLength, signal) => postJson("/api/uploads", { content_length: contentLength }, signal),
  uploadFile: (uploadUrl, file, signal, onProgress) => putFile(
    uploadUrl,
    file,
    timedSignal(signal, UPLOAD_TIMEOUT_MS),
    onProgress,
  ),
  createJob: ({ input_key, target_size_bytes, idempotencyKey }, signal) => postJson(
    "/api/jobs",
    { input_key, target_size_bytes },
    signal,
    idempotencyKey,
  ),
}
