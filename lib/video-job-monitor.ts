export type VideoJobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELED"

export type VideoJob = {
  id: string
  status: VideoJobStatus
  progress: number
  attempts: number
  output_expired?: boolean | null
  output_expires_at?: string | null
  error_message?: string | null
  target_size_bytes?: number | null
  output_key?: string | null
}

export type VideoJobMonitorErrorCode = "invalid_job_id" | "http_error" | "invalid_response" | "network_error"

export class VideoJobMonitorError extends Error {
  readonly code: VideoJobMonitorErrorCode
  readonly recoverable: boolean
  readonly status?: number

  constructor(
    code: VideoJobMonitorErrorCode,
    message: string,
    options: { recoverable?: boolean; status?: number } = {},
  ) {
    super(message)
    this.name = "VideoJobMonitorError"
    this.code = code
    this.recoverable = options.recoverable ?? false
    this.status = options.status
  }
}

export type VideoJobFetch = typeof fetch

export type MonitorVideoJobOptions = {
  signal?: AbortSignal
  pollIntervalMs?: number
  fetchImpl?: VideoJobFetch
  onJob?: (job: VideoJob) => void
  onError?: (error: VideoJobMonitorError) => void
}

const CONTROL_TIMEOUT_MS = 15_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TERMINAL_STATUSES = new Set<VideoJobStatus>(["COMPLETED", "FAILED", "CANCELED"])

export async function getVideoJob(
  jobId: string,
  signal?: AbortSignal,
  fetchImpl: VideoJobFetch = fetch,
): Promise<VideoJob> {
  assertJobId(jobId)
  const response = await fetchControl(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "GET" }, signal, fetchImpl)
  if (!response.ok) throw httpError(response.status)
  return parseVideoJob(await readJson(response, signal), jobId)
}

export async function cancelVideoJob(
  jobId: string,
  signal?: AbortSignal,
  fetchImpl: VideoJobFetch = fetch,
): Promise<VideoJob> {
  assertJobId(jobId)
  const response = await fetchControl(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }, signal, fetchImpl)
  if (response.status === 409) return getVideoJob(jobId, signal, fetchImpl)
  if (!response.ok) throw httpError(response.status)
  return parseVideoJob(await readJson(response, signal), jobId)
}

export async function monitorVideoJob(
  jobId: string,
  options: MonitorVideoJobOptions = {},
): Promise<VideoJob | undefined> {
  assertJobId(jobId)
  const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError("The video job polling interval must be a non-negative number.")
  }

  const fetchImpl = options.fetchImpl ?? fetch
  while (!options.signal?.aborted) {
    let job: VideoJob | undefined
    try {
      job = await getVideoJob(jobId, options.signal, fetchImpl)
    } catch (error) {
      if (options.signal?.aborted) return undefined
      if (!(error instanceof VideoJobMonitorError) || !error.recoverable) throw error
      if (!options.signal?.aborted) options.onError?.(error)
    }

    if (job) {
      if (options.signal?.aborted) return undefined
      options.onJob?.(job)
      if (options.signal?.aborted) return undefined
      if (TERMINAL_STATUSES.has(job.status)) return job
    }

    if (!await waitForPoll(options.signal, intervalMs)) return undefined
  }
  return undefined
}

async function fetchControl(
  path: string,
  init: Pick<RequestInit, "method">,
  externalSignal: AbortSignal | undefined,
  fetchImpl: VideoJobFetch,
): Promise<Response> {
  if (externalSignal?.aborted) throw abortError()
  const timeoutSignal = AbortSignal.timeout(CONTROL_TIMEOUT_MS)
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal

  try {
    return await fetchImpl(path, {
      ...init,
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    })
  } catch (error) {
    if (externalSignal?.aborted) throw abortError()
    const timedOut = error instanceof DOMException && error.name === "TimeoutError"
    throw new VideoJobMonitorError(
      "network_error",
      timedOut ? "Job status is taking too long. Retrying automatically." : "Job status is temporarily unavailable. Retrying automatically.",
      { recoverable: true },
    )
  }
}

function httpError(status: number): VideoJobMonitorError {
  const recoverable = status === 429 || status >= 500
  const message = status === 404
    ? "This video job could not be found. Choose another video to start a new job."
    : status === 400
      ? "This video job request is invalid. Choose another video to start a new job."
      : recoverable
        ? "Job status is temporarily unavailable. Retrying automatically."
        : `Could not check this video job (HTTP ${status}).`
  return new VideoJobMonitorError("http_error", message, { status, recoverable })
}

async function readJson(response: Response, externalSignal?: AbortSignal): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (externalSignal?.aborted) throw abortError()
    if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError"
      throw new VideoJobMonitorError(
        "network_error",
        timedOut ? "Job status is taking too long. Retrying automatically." : "Job status is temporarily unavailable. Retrying automatically.",
        { recoverable: true },
      )
    }
    throw invalidResponse()
  }
}

function parseVideoJob(value: unknown, expectedId: string): VideoJob {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !UUID_V4.test(value.id)
    || value.id.toLowerCase() !== expectedId.toLowerCase()
    || !isVideoJobStatus(value.status)
    || !Number.isInteger(value.progress)
    || (value.progress as number) < 0
    || (value.progress as number) > 100
    || !Number.isInteger(value.attempts)
    || (value.attempts as number) < 0
  ) {
    throw invalidResponse()
  }

  if (value.output_expired !== undefined && value.output_expired !== null && typeof value.output_expired !== "boolean") {
    throw invalidResponse()
  }
  if (value.output_expires_at !== undefined && value.output_expires_at !== null
    && (typeof value.output_expires_at !== "string" || !Number.isFinite(Date.parse(value.output_expires_at)))) {
    throw invalidResponse()
  }
  if (value.error_message !== undefined && value.error_message !== null && typeof value.error_message !== "string") {
    throw invalidResponse()
  }
  if (value.target_size_bytes !== undefined && value.target_size_bytes !== null
    && (!Number.isInteger(value.target_size_bytes) || (value.target_size_bytes as number) < 1)) {
    throw invalidResponse()
  }
  if (value.output_key !== undefined && value.output_key !== null && typeof value.output_key !== "string") {
    throw invalidResponse()
  }

  const status = value.status
  const progress = status === "COMPLETED" ? 100 : Math.min(value.progress as number, 99)
  return {
    id: value.id,
    status,
    progress,
    attempts: value.attempts as number,
    ...(value.output_expired !== undefined ? { output_expired: value.output_expired as boolean | null } : {}),
    ...(value.output_expires_at !== undefined ? { output_expires_at: value.output_expires_at as string | null } : {}),
    ...(value.error_message !== undefined ? { error_message: sanitizeJobError(value.error_message as string | null) } : {}),
    ...(value.target_size_bytes !== undefined ? { target_size_bytes: value.target_size_bytes as number | null } : {}),
    ...(value.output_key !== undefined ? { output_key: value.output_key as string | null } : {}),
  }
}

function sanitizeJobError(message: string | null): string | null {
  if (message === null) return null
  return message.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240)
}

function isVideoJobStatus(value: unknown): value is VideoJobStatus {
  return value === "QUEUED"
    || value === "PROCESSING"
    || value === "COMPLETED"
    || value === "FAILED"
    || value === "CANCELED"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalidResponse(): VideoJobMonitorError {
  return new VideoJobMonitorError("invalid_response", "The job service returned an invalid response. Try again.")
}

function assertJobId(jobId: string): void {
  if (!UUID_V4.test(jobId)) {
    throw new VideoJobMonitorError("invalid_job_id", "This video job ID is invalid. Choose another video to start a new job.")
  }
}

function abortError(): DOMException {
  return new DOMException("The request was canceled.", "AbortError")
}

function waitForPoll(signal: AbortSignal | undefined, delayMs: number): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => finish(true), delayMs)
    const finish = (shouldContinue: boolean) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      resolve(shouldContinue)
    }
    const onAbort = () => finish(false)
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}
