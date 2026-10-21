import { downloadShrinkcordJobFile, ShrinkcordApiError } from "@/lib/shrinkcord-api-client"
import { getShrinkcordApiBaseUrl } from "@/lib/shrinkcord-api-url"

export const MAX_VIDEO_OUTPUT_BYTES = 500 * 1024 * 1024

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
      options.status === undefined || options.status >= 500 || options.status === 429
    )
  }
}

export type FetchVideoJobOutputOptions = {
  signal?: AbortSignal
  apiBaseUrl?: string
  onProgress?: (loaded: number, total: number | null) => void
}

export type VideoJobOutput = { blob: Blob; bytes: number }

export async function fetchVideoJobOutput(
  jobId: string,
  options: FetchVideoJobOutputOptions = {},
): Promise<VideoJobOutput> {
  const baseUrl = options.apiBaseUrl ?? getShrinkcordApiBaseUrl()
  try {
    const blob = await downloadShrinkcordJobFile(jobId, {
      signal: options.signal,
      baseUrl,
      onProgress: options.onProgress,
    })
    if (blob.size > MAX_VIDEO_OUTPUT_BYTES) {
      throw new VideoOutputError("The video exceeds the 500 MiB download limit.", { status: 413, retryable: false })
    }
    return { blob, bytes: blob.size }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error
    if (error instanceof ShrinkcordApiError) {
      if (error.status === 404) {
        throw new VideoOutputError("This video output is no longer available.", { status: 404, retryable: false, expired: true })
      }
      throw new VideoOutputError(error.message, { status: error.status, retryable: error.retryable })
    }
    if (error instanceof VideoOutputError) throw error
    throw new VideoOutputError("Could not download this video's output. Try again.", { retryable: true })
  }
}

export function getVideoOutputFileName(inputFileName: string): string {
  const baseName = inputFileName.split(/[\\/]/).pop()?.trim() || "video"
  const stem = baseName.replace(/\.[^.]+$/, "") || "video"
  return `${stem}-discord.mp4`
}
