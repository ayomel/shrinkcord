import {
  browserShrinkcordApiTransport,
  type ShrinkcordApiTransport,
} from "@/lib/api/shrinkcordApiClient"

export type VideoJobPhase = "uploading" | "server_busy" | "queued"

export type VideoJobAttempt = {
  file: File
  targetSizeBytes: number
  jobId?: string
  inFlight?: boolean
}

export type VideoJobTransport = Pick<ShrinkcordApiTransport, "uploadJob">

type SubmitVideoJobOptions = {
  file: File
  targetSizeBytes: number
  attempt: VideoJobAttempt
  signal?: AbortSignal
  transport?: VideoJobTransport
  baseUrl?: string
  onPhase?: (phase: VideoJobPhase) => void
  onProgress?: (percent: number) => void
  onRateLimited?: (retryAfterMs: number, attempt: number) => void
}

export function createVideoJobAttempt(
  file: File,
  targetSizeBytes: number,
): VideoJobAttempt {
  return { file, targetSizeBytes }
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
  const transport = options.transport ?? browserShrinkcordApiTransport
  try {
    options.onPhase?.("uploading")
    const result = await transport.uploadJob({
      file,
      targetSizeBytes,
      signal: options.signal,
      baseUrl: options.baseUrl,
      existingJobId: attempt.jobId,
      onRateLimited: (delayMs, count) => {
        options.onPhase?.("server_busy")
        options.onRateLimited?.(delayMs, count)
      },
      onUploadProgress: (loaded, total) => {
        if (total > 0) {
          options.onProgress?.(Math.min(99, Math.max(0, Math.round((loaded / total) * 100))))
        }
      },
    })
    attempt.jobId = result.id
    options.onPhase?.("queued")
    return { jobId: result.id }
  } finally {
    attempt.inFlight = false
  }
}

function abortError() {
  return new DOMException("The request was canceled.", "AbortError")
}
