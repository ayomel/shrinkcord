import { ShrinkcordApiError } from "@/lib/api/shrinkcordApiClient"
import { VideoJobMonitorError } from "@/lib/video/videoJobMonitor"
import { VideoOutputError } from "@/lib/video/videoJobOutput"

export function mapVideoQueueError(error: unknown): { message: string; canRetry: boolean } {
  if (error instanceof ShrinkcordApiError) {
    return {
      message: error.message,
      canRetry: error.retryable || error.retriesExhausted === true,
    }
  }
  if (error instanceof VideoOutputError) {
    return { message: error.message, canRetry: error.retryable && !error.expired }
  }
  if (error instanceof VideoJobMonitorError) {
    return { message: error.message, canRetry: error.recoverable }
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { message: "Canceled.", canRetry: false }
  }
  if (error instanceof Error) return { message: error.message, canRetry: false }
  return { message: "Could not process this video. Try again.", canRetry: true }
}
