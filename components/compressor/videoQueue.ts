import type { MutableRefObject } from "react"

import { isShrinkcordCloudStorageConfigured } from "@/lib/api/shrinkcordApiUrl"
import { monitorVideoJob } from "@/lib/video/videoJobMonitor"
import { fetchVideoJobOutput } from "@/lib/video/videoJobOutput"
import { requestServerJobCancel } from "@/lib/video/videoServerCleanup"
import { createVideoJobAttempt, submitVideoJob } from "@/lib/video/videoJobs"
import { DEFAULT_VIDEO_TARGET_BYTES } from "@/lib/video/videoSelection"
import { mapVideoQueueError } from "./videoQueueErrors"
import type { QueueLifecycle } from "./queueLifecycle"
import type { QueueItem, VideoItemStatus, VideoQueueItem } from "./types"

export type VideoQueueContext = {
  itemsRef: MutableRefObject<QueueItem[]>
  videoRunning: MutableRefObject<boolean>
  videoControllers: MutableRefObject<Map<string, AbortController>>
  videoAttempts: MutableRefObject<Map<string, ReturnType<typeof createVideoJobAttempt>>>
  urls: MutableRefObject<string[]>
  lifecycle: QueueLifecycle
  update: (id: string, patch: Partial<QueueItem>) => void
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

async function processVideo(context: VideoQueueContext, itemId: string, generation: number) {
  const item = context.itemsRef.current.find(
    (entry): entry is VideoQueueItem => entry.kind === "video" && entry.id === itemId,
  )
  if (!item) return
  if (item.status !== "queued" && !(item.status === "error" && item.canRetry)) return

  const controller = new AbortController()
  context.videoControllers.current.set(itemId, controller)
  const isCurrentWork = () =>
    context.lifecycle.isCurrent(generation)
    && !controller.signal.aborted
    && context.videoControllers.current.get(itemId) === controller
    && context.itemsRef.current.some((entry) => entry.id === itemId)
  const updateCurrent = (patch: Partial<QueueItem>) => {
    if (isCurrentWork()) context.update(itemId, patch)
  }
  updateCurrent({
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
      onProgress: (percent) => updateCurrent({ status: "uploading", uploadProgress: percent }),
      onRateLimited: () => updateCurrent({ status: "server_busy" }),
    })
    if (!isCurrentWork()) {
      void requestServerJobCancel(jobId)
      return
    }
    updateCurrent({ jobId, status: "job_queued", uploadProgress: 100, compressProgress: 0 })

    const terminal = await monitorVideoJob(jobId, {
      signal: controller.signal,
      pollIntervalMs: 2_000,
      onJob: (job) => {
        updateCurrent({
          status: mapApiStatusToUi(job.status),
          compressProgress: job.progress,
          outputBytes: job.output_bytes ?? undefined,
        })
      },
    })

    if (!isCurrentWork()) return
    if (!terminal) {
      updateCurrent({ status: "canceled" })
      return
    }
    if (terminal.status === "FAILED") {
      updateCurrent({
        status: "error",
        error: terminal.error_message || "Compression failed. Try again.",
      })
      return
    }
    if (terminal.status === "CANCELED") {
      updateCurrent({ status: "canceled" })
      return
    }

    const storageDownloadUrl = terminal.download_url ?? undefined
    const storageExpiresAt = terminal.expires_at ?? undefined
    const storageNotSaved = isShrinkcordCloudStorageConfigured() && !storageDownloadUrl

    updateCurrent({ status: "downloading", downloadProgress: 0 })
    const output = await fetchVideoJobOutput(jobId, {
      signal: controller.signal,
      downloadUrl: storageDownloadUrl,
      onProgress: (loaded, total) => {
        const percent = total && total > 0
          ? Math.min(99, Math.round((loaded / total) * 100))
          : 0
        updateCurrent({ downloadProgress: percent })
      },
    })
    const downloadUrl = URL.createObjectURL(output.blob)
    if (!isCurrentWork()) {
      URL.revokeObjectURL(downloadUrl)
      return
    }
    context.urls.current.push(downloadUrl)
    updateCurrent({
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
    if (!isCurrentWork()) return
    if (error instanceof DOMException && error.name === "AbortError") {
      updateCurrent({ status: "canceled" })
      return
    }
    const mapped = mapVideoQueueError(error)
    updateCurrent({ status: "error", error: mapped.message, canRetry: mapped.canRetry })
  } finally {
    if (context.videoControllers.current.get(itemId) === controller) {
      context.videoControllers.current.delete(itemId)
    }
  }
}

export async function drainVideos(context: VideoQueueContext) {
  if (context.videoRunning.current) return
  const generation = context.lifecycle.capture()
  context.videoRunning.current = true
  try {
    while (context.lifecycle.isCurrent(generation) && context.itemsRef.current.some((item) => item.kind === "video" && item.status === "queued")) {
      const next = context.itemsRef.current.find(
        (item): item is VideoQueueItem => item.kind === "video" && item.status === "queued",
      )
      if (!next) break
      await processVideo(context, next.id, generation)
    }
  } finally {
    context.videoRunning.current = false
    if (context.lifecycle.isAlive() && context.itemsRef.current.some((item) => item.kind === "video" && item.status === "queued")) {
      void drainVideos(context)
    }
  }
}
