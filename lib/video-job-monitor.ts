import {
  browserShrinkcordApiTransport,
  ShrinkcordApiError,
  type ShrinkcordApiTransport,
  type ShrinkcordJob,
  type ShrinkcordJobStatus,
} from "@/lib/shrinkcord-api-client"
import { getShrinkcordApiBaseUrl } from "@/lib/shrinkcord-api-url"
import { normalizeCompressProgress } from "@/lib/video-progress"

export type VideoJobStatus = ShrinkcordJobStatus

export type VideoJob = {
  id: string
  status: VideoJobStatus
  progress: number
  source_bytes: number | null
  output_bytes: number | null
  error_message: string | null
  target_size_bytes: number | null
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
  baseUrl?: string
  transport?: Pick<ShrinkcordApiTransport, "getJob">
  onJob?: (job: VideoJob) => void
  onError?: (error: VideoJobMonitorError) => void
}

const DEFAULT_POLL_INTERVAL_MS = 2_000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TERMINAL_STATUSES = new Set<VideoJobStatus>(["COMPLETED", "FAILED", "CANCELED"])

function toVideoJob(job: ShrinkcordJob): VideoJob {
  return {
    id: job.id,
    status: job.status,
    progress: normalizeCompressProgress(job.status, job.progress),
    source_bytes: job.source_bytes,
    output_bytes: job.output_bytes,
    error_message: job.error_message,
    target_size_bytes: job.target_size_bytes,
  }
}

export async function getVideoJob(
  jobId: string,
  signal?: AbortSignal,
  baseUrl?: string,
  transport: Pick<ShrinkcordApiTransport, "getJob"> = browserShrinkcordApiTransport,
): Promise<VideoJob> {
  assertJobId(jobId)
  try {
    const raw = await transport.getJob(jobId, signal, baseUrl ?? getShrinkcordApiBaseUrl())
    return toVideoJob(raw)
  } catch (error) {
    throw mapClientError(error)
  }
}

export async function cancelVideoJob(
  jobId: string,
  signal?: AbortSignal,
  baseUrl?: string,
  transport: Pick<ShrinkcordApiTransport, "cancelJob"> = browserShrinkcordApiTransport,
): Promise<VideoJob> {
  assertJobId(jobId)
  try {
    const job = await transport.cancelJob(jobId, signal, baseUrl ?? getShrinkcordApiBaseUrl())
    return toVideoJob(job)
  } catch (error) {
    throw mapClientError(error)
  }
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

  const transport = options.transport ?? browserShrinkcordApiTransport
  const baseUrl = options.baseUrl ?? getShrinkcordApiBaseUrl()

  while (!options.signal?.aborted) {
    let job: VideoJob | undefined
    try {
      const raw = await transport.getJob(jobId, options.signal, baseUrl)
      job = toVideoJob(raw)
    } catch (error) {
      if (options.signal?.aborted) return undefined
      const monitorError = mapClientError(error)
      if (!monitorError.recoverable) throw monitorError
      if (!options.signal?.aborted) options.onError?.(monitorError)
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

function mapClientError(error: unknown): VideoJobMonitorError {
  if (error instanceof VideoJobMonitorError) return error
  if (error instanceof DOMException && error.name === "AbortError") {
    throw error
  }
  if (error instanceof ShrinkcordApiError) {
    const status = error.status
    const retryable = error.retryable
    if (status === 404) {
      return new VideoJobMonitorError(
        "http_error",
        "This video job could not be found. Choose another video to start a new job.",
        { status, recoverable: false },
      )
    }
    if (retryable) {
      return new VideoJobMonitorError(
        "network_error",
        "Job status is temporarily unavailable. Retrying automatically.",
        { status, recoverable: true },
      )
    }
    return new VideoJobMonitorError("invalid_response", error.message, { recoverable: false, status })
  }
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: number }).status)
    : undefined
  const retryable = typeof error === "object" && error !== null && "retryable" in error
    ? Boolean((error as { retryable?: boolean }).retryable)
    : status === 429 || (status !== undefined && status >= 500)

  if (status === 404) {
    return new VideoJobMonitorError(
      "http_error",
      "This video job could not be found. Choose another video to start a new job.",
      { status, recoverable: false },
    )
  }
  if (status === 400) {
    return new VideoJobMonitorError(
      "http_error",
      "This video job request is invalid. Choose another video to start a new job.",
      { status, recoverable: false },
    )
  }
  if (retryable) {
    return new VideoJobMonitorError(
      "network_error",
      "Job status is temporarily unavailable. Retrying automatically.",
      { status, recoverable: true },
    )
  }
  return new VideoJobMonitorError(
    "invalid_response",
    error instanceof Error ? error.message : "The job service returned an invalid response. Try again.",
    { recoverable: false },
  )
}

function assertJobId(jobId: string): void {
  if (!UUID_V4.test(jobId)) {
    throw new VideoJobMonitorError("invalid_job_id", "This video job ID is invalid. Choose another video to start a new job.")
  }
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
