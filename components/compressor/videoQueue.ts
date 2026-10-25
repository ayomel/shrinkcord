import type { MutableRefObject } from "react"

import { ShrinkcordApiError } from "@/lib/shrinkcord-api-client"
import { isShrinkcordCloudStorageConfigured } from "@/lib/shrinkcord-api-url"
import { monitorVideoJob } from "@/lib/video-job-monitor"
import { fetchVideoJobOutput } from "@/lib/video-job-output"
import { requestServerJobCancel } from "@/lib/video-server-cleanup"
import { createVideoJobAttempt, submitVideoJob } from "@/lib/video-jobs"
import { DEFAULT_VIDEO_TARGET_BYTES } from "@/lib/video-selection"
import type { QueueItem, VideoItemStatus, VideoQueueItem } from "./types"

export type VideoQueueContext = {
  itemsRef: MutableRefObject<QueueItem[]>
  videoRunning: MutableRefObject<boolean>
  videoControllers: MutableRefObject<Map<string, AbortController>>
  videoAttempts: MutableRefObject<Map<string, ReturnType<typeof createVideoJobAttempt>>>
  urls: MutableRefObject<string[]>
  update: (id: string, patch: Partial<QueueItem>) => void
}

function mapVideoApiError(error: unknown): { message: string; canRetry: boolean } {
  if (error instanceof ShrinkcordApiError) {
    return {
      message: error.message,
      canRetry: error.retriesExhausted === true,
    }
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { message: "Canceled.", canRetry: false }
  }
  if (error instanceof Error) return { message: error.message, canRetry: false }
  return { message: "Could not process this video. Try again.", canRetry: true }
}

export async function stopVideoWork(context: VideoQueueContext, target: VideoQueueItem) {
  const controller = context.videoControllers.current.get(target.id)
  controller?.abort()
  if (target.jobId) await requestServerJobCancel(target.jobId)
}

function mapApiStatusToUi(apiStatus: string): VideoItemStatus {
  if (apiStatus === "QUEUED") return "job_queued"
  if (apiStatus === "PROCESSING") return "processing"
  return "processing"
}

async function processVideo(context: VideoQueueContext, itemId: string) {
  const item = context.itemsRef.current.find(
    (entry): entry is VideoQueueItem => entry.kind === "video" && entry.id === itemId,
  )
  if (!item) return
  if (item.status !== "queued" && !(item.status === "error" && item.canRetry)) return

  const controller = new AbortController()
  context.videoControllers.current.set(itemId, controller)
  context.update(itemId, {
    status: "uploading",
    uploadProgress: 0,
    compressProgress: 0,
    downloadProgress: 0,
    error: undefined,
    canRetry: false,
  })

  let attempt = context.videoAttempts.current.get(itemId)
  if (!attempt) {
    attempt = createVideoJobAttempt(item.file, DEFAULT_VIDEO_TARGET_BYTES)
    context.videoAttempts.current.set(itemId, attempt)
  }

  try {
    const { jobId } = await submitVideoJob({
      file: item.file,
      targetSizeBytes: DEFAULT_VIDEO_TARGET_BYTES,
      attempt,
      signal: controller.signal,
      onProgress: (percent) => context.update(itemId, { status: "uploading", uploadProgress: percent }),
      onRateLimited: () => context.update(itemId, { status: "server_busy" }),
    })
    if (!context.itemsRef.current.some((entry) => entry.id === itemId)) return
    context.update(itemId, { jobId, status: "job_queued", uploadProgress: 100, compressProgress: 0 })

    const terminal = await monitorVideoJob(jobId, {
      signal: controller.signal,
      pollIntervalMs: 2_000,
      onJob: (job) => {
        context.update(itemId, {
          status: mapApiStatusToUi(job.status),
          compressProgress: job.progress,
          outputBytes: job.output_bytes ?? undefined,
        })
      },
    })

    if (!context.itemsRef.current.some((entry) => entry.id === itemId)) return
    if (!terminal) {
      context.update(itemId, { status: "canceled" })
      return
    }
    if (terminal.status === "FAILED") {
      context.update(itemId, {
        status: "error",
        error: terminal.error_message || "Compression failed. Try again.",
      })
      return
    }
    if (terminal.status === "CANCELED") {
      context.update(itemId, { status: "canceled" })
      return
    }

    const storageDownloadUrl = terminal.download_url ?? undefined
    const storageExpiresAt = terminal.expires_at ?? undefined
    const storageNotSaved = isShrinkcordCloudStorageConfigured() && !storageDownloadUrl

    context.update(itemId, { status: "downloading", downloadProgress: 0 })
    const output = await fetchVideoJobOutput(jobId, {
      signal: controller.signal,
      downloadUrl: storageDownloadUrl,
      onProgress: (loaded, total) => {
        const percent = total && total > 0
          ? Math.min(99, Math.round((loaded / total) * 100))
          : 0
        context.update(itemId, { downloadProgress: percent })
      },
    })
    const downloadUrl = URL.createObjectURL(output.blob)
    context.urls.current.push(downloadUrl)
    context.update(itemId, {
      status: "done",
      compressProgress: 100,
      downloadProgress: 100,
      outputBytes: output.bytes,
      downloadUrl,
      storageDownloadUrl,
      storageExpiresAt,
      storageNotSaved,
    })
  } catch (error) {
    if (!context.itemsRef.current.some((entry) => entry.id === itemId)) return
    if (error instanceof DOMException && error.name === "AbortError") {
      context.update(itemId, { status: "canceled" })
      return
    }
    const mapped = mapVideoApiError(error)
    context.update(itemId, { status: "error", error: mapped.message, canRetry: mapped.canRetry })
  } finally {
    context.videoControllers.current.delete(itemId)
  }
}

export async function drainVideos(context: VideoQueueContext) {
  if (context.videoRunning.current) return
  context.videoRunning.current = true
  try {
    while (context.itemsRef.current.some((item) => item.kind === "video" && item.status === "queued")) {
      const next = context.itemsRef.current.find(
        (item): item is VideoQueueItem => item.kind === "video" && item.status === "queued",
      )
      if (!next) break
      await processVideo(context, next.id)
    }
  } finally {
    context.videoRunning.current = false
  }
}
