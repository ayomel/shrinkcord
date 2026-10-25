"use client"

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"

import { zipSync } from "fflate"
import { AlertCircle, X } from "lucide-react"

import { MediaDropZone } from "@/components/MediaDropZone"
import { StorageResultNote } from "@/components/StorageResultNote"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Progress } from "@/components/ui/Progress"
import { type ShrinkResult, typeLabel } from "@/lib/compress"
import { formatDropClassifyErrors, type DropRejection } from "@/lib/drop-rejection-messages"
import { classifyFileAsync } from "@/lib/file-classification"
import { formatMegabytes } from "@/lib/limits"
import { runShrink } from "@/lib/run-shrink"
import { ShrinkcordApiError } from "@/lib/shrinkcord-api-client"
import {
  isShrinkcordCloudStorageConfigured,
  isShrinkcordVideoApiConfigured,
  VIDEO_API_DISABLED_MESSAGE,
} from "@/lib/shrinkcord-api-url"
import { enqueueStorageSaveByFileName } from "@/lib/shrinkcord-storage-queue"
import { isStorageUserAbort, uploadCompressedBlobToStorage } from "@/lib/shrinkcord-storage-upload"
import { getVideoOutputFileName, fetchVideoJobOutput } from "@/lib/video-job-output"
import { monitorVideoJob } from "@/lib/video-job-monitor"
import { videoProgressSnapshot } from "@/lib/video-progress"
import { probeVideoDuration } from "@/lib/video-precheck"
import { requestServerJobCancel } from "@/lib/video-server-cleanup"
import { createVideoJobAttempt, submitVideoJob } from "@/lib/video-jobs"
import { DEFAULT_VIDEO_TARGET_BYTES } from "@/lib/video-selection"
import { videoRetryUiFlags } from "@/lib/video-row-retry-ui"

type ImageItemStatus = "queued" | "working" | "done" | "error"

type ImageQueueItem = {
  kind: "image"
  id: string
  file: File
  status: ImageItemStatus
  progress: number
  uploadProgress?: number
  storageUploadInProgress?: boolean
  error?: string
  result?: ShrinkResult
  downloadUrl?: string
  storageDownloadUrl?: string
  storageExpiresAt?: string
  storageNotSaved?: boolean
  storagePassthrough?: boolean
  thumbUrl?: string
}

type VideoItemStatus =
  | "precheck"
  | "queued"
  | "uploading"
  | "server_busy"
  | "job_queued"
  | "processing"
  | "downloading"
  | "done"
  | "error"
  | "canceled"

type VideoQueueItem = {
  kind: "video"
  id: string
  file: File
  status: VideoItemStatus
  uploadProgress: number
  compressProgress: number
  downloadProgress: number
  error?: string
  canRetry?: boolean
  jobId?: string
  outputBytes?: number
  downloadUrl?: string
  storageDownloadUrl?: string
  storageExpiresAt?: string
  storageNotSaved?: boolean
}

type QueueItem = ImageQueueItem | VideoQueueItem

const videoApiEnabled = isShrinkcordVideoApiConfigured()

function videoThumbLabel(file: File): string {
  if (file.type === "video/quicktime" || /\.mov$/i.test(file.name)) return "MOV"
  return "MP4"
}

function ResultThumb({ url, name, file }: { url?: string; name: string; file: File }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- object URL preview
      <img
        src={url}
        alt=""
        className="size-11 shrink-0 rounded-lg object-cover"
        title={name}
      />
    )
  }
  if (file.type.startsWith("video/") || /\.(mp4|mov)$/i.test(file.name)) {
    return (
      <div
        className="size-11 shrink-0 rounded-lg bg-[#1a1c22] grid place-items-center text-[10px] font-semibold uppercase text-muted-foreground"
        aria-hidden="true"
      >
        {videoThumbLabel(file)}
      </div>
    )
  }
  return (
    <div
      className="size-11 shrink-0 rounded-lg bg-[linear-gradient(135deg,#7a5cff,#2bb3a3_60%,#f2b84b)]"
      aria-hidden="true"
    />
  )
}

async function makeThumbUrl(file: File): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 88, resizeQuality: "low" })
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (!context) {
      bitmap.close()
      return undefined
    }
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.72)
    })
    if (!blob) return undefined
    return URL.createObjectURL(blob)
  } catch {
    return undefined
  }
}

function revokeTracked(urls: MutableRefObject<string[]>, url?: string) {
  if (!url) return
  URL.revokeObjectURL(url)
  urls.current = urls.current.filter((entry) => entry !== url)
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

export function Compressor() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [classifyError, setClassifyError] = useState<string | null>(null)
  const itemsRef = useRef<QueueItem[]>([])
  const imageRunning = useRef(false)
  const videoRunning = useRef(false)
  const urls = useRef<string[]>([])
  const videoControllers = useRef<Map<string, AbortController>>(new Map())
  const imageStorageControllers = useRef<Map<string, AbortController>>(new Map())
  const videoAttempts = useRef<Map<string, ReturnType<typeof createVideoJobAttempt>>>(new Map())

  useEffect(() => {
    const tracked = urls
    return () => {
      for (const url of tracked.current) URL.revokeObjectURL(url)
    }
  }, [])

  const update = useCallback((id: string, patch: Partial<QueueItem>) => {
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === id ? { ...item, ...patch } as QueueItem : item,
    )
    setItems([...itemsRef.current])
  }, [])

  const drainImages = async () => {
    if (imageRunning.current) return
    imageRunning.current = true
    try {
      while (itemsRef.current.some((item) => item.kind === "image" && item.status === "queued")) {
        const current = itemsRef.current.find(
          (item): item is ImageQueueItem => item.kind === "image" && item.status === "queued",
        )
        if (!current) break
        update(current.id, { status: "working", progress: 4 })

        const classified = await classifyFileAsync(current.file)
        if (classified.kind !== "image") {
          update(current.id, { status: "error", progress: 0, error: "Use a JPEG, PNG, or WebP." })
          continue
        }

        try {
          const result = await runShrink(current.file, (progress) => {
            if (!itemsRef.current.some((entry) => entry.id === current.id)) return
            update(current.id, { progress })
          })
          const downloadUrl = URL.createObjectURL(result.blob)
          const stillPresent = itemsRef.current.some((entry) => entry.id === current.id)
          if (!stillPresent) {
            URL.revokeObjectURL(downloadUrl)
            continue
          }
          urls.current.push(downloadUrl)

          if (result.passthrough) {
            update(current.id, {
              status: "done",
              progress: 100,
              result,
              downloadUrl,
              storagePassthrough: true,
            })
            continue
          }

          const storageEnabled = isShrinkcordCloudStorageConfigured()
          update(current.id, {
            status: "done",
            progress: 100,
            result,
            downloadUrl,
            storageNotSaved: !storageEnabled,
            storageUploadInProgress: storageEnabled,
            uploadProgress: storageEnabled ? 0 : undefined,
          })

          if (!storageEnabled) continue

          const controller = new AbortController()
          imageStorageControllers.current.set(current.id, controller)
          void enqueueStorageSaveByFileName(result.fileName, () =>
            uploadCompressedBlobToStorage({
              blob: result.blob,
              fileName: result.fileName,
              contentType: result.outputType,
              signal: controller.signal,
              onProgress: (percent) => {
                if (!itemsRef.current.some((entry) => entry.id === current.id)) return
                update(current.id, { uploadProgress: percent, storageUploadInProgress: true })
              },
            }),
          )
            .then((storage) => {
              imageStorageControllers.current.delete(current.id)
              if (!itemsRef.current.some((entry) => entry.id === current.id)) return
              if (storage.ok) {
                update(current.id, {
                  storageDownloadUrl: storage.downloadUrl,
                  storageExpiresAt: storage.expiresAt,
                  storageNotSaved: false,
                  storageUploadInProgress: false,
                  uploadProgress: 100,
                })
              } else {
                update(current.id, {
                  storageNotSaved: true,
                  storageUploadInProgress: false,
                  uploadProgress: 100,
                })
              }
            })
            .catch((error) => {
              imageStorageControllers.current.delete(current.id)
              if (isStorageUserAbort(error)) return
              if (!itemsRef.current.some((entry) => entry.id === current.id)) return
              update(current.id, {
                storageNotSaved: true,
                storageUploadInProgress: false,
              })
            })
        } catch (error) {
          if (!itemsRef.current.some((entry) => entry.id === current.id)) continue
          update(current.id, {
            status: "error",
            progress: 0,
            error: error instanceof Error ? error.message : "Could not shrink this image.",
          })
        }
      }
    } finally {
      imageRunning.current = false
    }
  }

  const mapApiStatusToUi = (apiStatus: string): VideoItemStatus => {
    if (apiStatus === "QUEUED") return "job_queued"
    if (apiStatus === "PROCESSING") return "processing"
    return "processing"
  }

  const processVideo = async (itemId: string) => {
    const item = itemsRef.current.find(
      (entry): entry is VideoQueueItem => entry.kind === "video" && entry.id === itemId,
    )
    if (!item) return
    if (item.status !== "queued" && !(item.status === "error" && item.canRetry)) return

    const controller = new AbortController()
    videoControllers.current.set(itemId, controller)
    update(itemId, {
      status: "uploading",
      uploadProgress: 0,
      compressProgress: 0,
      downloadProgress: 0,
      error: undefined,
      canRetry: false,
    })

    let attempt = videoAttempts.current.get(itemId)
    if (!attempt) {
      attempt = createVideoJobAttempt(item.file, DEFAULT_VIDEO_TARGET_BYTES)
      videoAttempts.current.set(itemId, attempt)
    }

    try {
      const { jobId } = await submitVideoJob({
        file: item.file,
        targetSizeBytes: DEFAULT_VIDEO_TARGET_BYTES,
        attempt,
        signal: controller.signal,
        onProgress: (percent) => update(itemId, { status: "uploading", uploadProgress: percent }),
        onRateLimited: () => update(itemId, { status: "server_busy" }),
      })
      if (!itemsRef.current.some((entry) => entry.id === itemId)) return
      update(itemId, { jobId, status: "job_queued", uploadProgress: 100, compressProgress: 0 })

      const terminal = await monitorVideoJob(jobId, {
        signal: controller.signal,
        pollIntervalMs: 2_000,
        onJob: (job) => {
          update(itemId, {
            status: mapApiStatusToUi(job.status),
            compressProgress: job.progress,
            outputBytes: job.output_bytes ?? undefined,
          })
        },
      })

      if (!itemsRef.current.some((entry) => entry.id === itemId)) return
      if (!terminal) {
        update(itemId, { status: "canceled" })
        return
      }
      if (terminal.status === "FAILED") {
        update(itemId, {
          status: "error",
          error: terminal.error_message || "Compression failed. Try again.",
        })
        return
      }
      if (terminal.status === "CANCELED") {
        update(itemId, { status: "canceled" })
        return
      }

      const storageDownloadUrl = terminal.download_url ?? undefined
      const storageExpiresAt = terminal.expires_at ?? undefined
      const storageNotSaved = isShrinkcordCloudStorageConfigured() && !storageDownloadUrl

      update(itemId, { status: "downloading", downloadProgress: 0 })
      const output = await fetchVideoJobOutput(jobId, {
        signal: controller.signal,
        downloadUrl: storageDownloadUrl,
        onProgress: (loaded, total) => {
          const percent = total && total > 0
            ? Math.min(99, Math.round((loaded / total) * 100))
            : 0
          update(itemId, { downloadProgress: percent })
        },
      })
      const downloadUrl = URL.createObjectURL(output.blob)
      urls.current.push(downloadUrl)
      update(itemId, {
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
      if (!itemsRef.current.some((entry) => entry.id === itemId)) return
      if (error instanceof DOMException && error.name === "AbortError") {
        update(itemId, { status: "canceled" })
        return
      }
      const mapped = mapVideoApiError(error)
      update(itemId, { status: "error", error: mapped.message, canRetry: mapped.canRetry })
    } finally {
      videoControllers.current.delete(itemId)
    }
  }

  const drainVideos = async () => {
    if (videoRunning.current) return
    videoRunning.current = true
    try {
      while (itemsRef.current.some((item) => item.kind === "video" && item.status === "queued")) {
        const next = itemsRef.current.find(
          (item): item is VideoQueueItem => item.kind === "video" && item.status === "queued",
        )
        if (!next) break
        await processVideo(next.id)
      }
    } finally {
      videoRunning.current = false
    }
  }

  const enqueueFiles = async (files: File[]) => {
    setClassifyError(null)
    const rejections: DropRejection[] = []
    const newImages: ImageQueueItem[] = []
    const newVideos: VideoQueueItem[] = []

    for (const file of files) {
      const classified = await classifyFileAsync(file)
      if (classified.kind === "image") {
        newImages.push({
          kind: "image",
          id: crypto.randomUUID(),
          file,
          status: "queued",
          progress: 0,
        })
      } else if (classified.kind === "video") {
        if (!videoApiEnabled) {
          rejections.push({ kind: "video-unavailable", fileName: file.name })
          continue
        }
        const id = crypto.randomUUID()
        newVideos.push({
          kind: "video",
          id,
          file,
          status: "precheck",
          uploadProgress: 0,
          compressProgress: 0,
          downloadProgress: 0,
        })
        void (async () => {
          const precheck = await probeVideoDuration(file)
          if (!itemsRef.current.some((entry) => entry.id === id)) return
          if (!precheck.ok) {
            update(id, { status: "error", error: precheck.message })
            return
          }
          update(id, { status: "queued" })
          void drainVideos()
        })()
      } else {
        rejections.push({ kind: "wrong-type", fileName: file.name })
      }
    }

    const rejectionMessage = formatDropClassifyErrors(rejections, videoApiEnabled)
    if (rejectionMessage) {
      setClassifyError(rejectionMessage)
    }

    if (newImages.length === 0 && newVideos.length === 0) return

    itemsRef.current = [...itemsRef.current, ...newImages, ...newVideos]
    setItems([...itemsRef.current])

    for (const item of newImages) {
      void makeThumbUrl(item.file).then((thumbUrl) => {
        if (!thumbUrl) return
        if (!itemsRef.current.some((entry) => entry.id === item.id)) {
          URL.revokeObjectURL(thumbUrl)
          return
        }
        urls.current.push(thumbUrl)
        update(item.id, { thumbUrl })
      })
    }

    void drainImages()
    void drainVideos()
  }

  const stopVideoWork = async (target: VideoQueueItem) => {
    const controller = videoControllers.current.get(target.id)
    controller?.abort()
    if (target.jobId) await requestServerJobCancel(target.jobId)
  }

  const stopImageStorage = (id: string) => {
    imageStorageControllers.current.get(id)?.abort()
    imageStorageControllers.current.delete(id)
  }

  const removeItem = (id: string) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (!target) return
    if (target.kind === "image") stopImageStorage(id)
    if (target.kind === "video") void stopVideoWork(target)
    videoAttempts.current.delete(id)
    if (target.kind === "image") {
      revokeTracked(urls, target.thumbUrl)
      revokeTracked(urls, target.downloadUrl)
    } else {
      revokeTracked(urls, target.downloadUrl)
    }
    itemsRef.current = itemsRef.current.filter((item) => item.id !== id)
    setItems([...itemsRef.current])
  }

  const cancelVideo = async (id: string) => {
    const target = itemsRef.current.find(
      (item): item is VideoQueueItem => item.kind === "video" && item.id === id,
    )
    if (!target) return
    await stopVideoWork(target)
    update(id, { status: "canceled" })
  }

  const retryVideo = (id: string) => {
    videoAttempts.current.delete(id)
    update(id, { status: "queued", error: undefined, canRetry: false })
    void drainVideos()
  }

  const clearAll = () => {
    for (const item of itemsRef.current) {
      if (item.kind === "image") stopImageStorage(item.id)
      if (item.kind === "video") void stopVideoWork(item)
    }
    for (const controller of videoControllers.current.values()) controller.abort()
    videoControllers.current.clear()
    for (const controller of imageStorageControllers.current.values()) controller.abort()
    imageStorageControllers.current.clear()
    videoAttempts.current.clear()
    for (const item of itemsRef.current) {
      if (item.kind === "image") {
        revokeTracked(urls, item.thumbUrl)
        revokeTracked(urls, item.downloadUrl)
      } else {
        revokeTracked(urls, item.downloadUrl)
      }
    }
    itemsRef.current = []
    setItems([])
  }

  const downloadOne = (item: QueueItem) => {
    if (!item.downloadUrl) return
    const anchor = document.createElement("a")
    anchor.href = item.downloadUrl
    if (item.kind === "image" && item.result) {
      anchor.download = item.result.fileName
    } else if (item.kind === "video") {
      anchor.download = getVideoOutputFileName(item.file.name)
    }
    anchor.click()
  }

  const downloadable = items.filter((item) => item.status === "done" && item.downloadUrl)

  const downloadAll = async () => {
    if (downloadable.length === 0) return
    const entries: Record<string, Uint8Array> = {}
    const usedNames = new Set<string>()

    for (const item of downloadable) {
      const buffer = new Uint8Array(await (await fetch(item.downloadUrl!)).arrayBuffer())
      let name: string
      if (item.kind === "image" && item.result) {
        name = item.result.fileName
      } else if (item.kind === "video") {
        name = getVideoOutputFileName(item.file.name)
      } else {
        continue
      }
      if (usedNames.has(name)) {
        const stem = name.replace(/(\.[^.]+)?$/, "")
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
        let n = 2
        while (usedNames.has(`${stem}-${n}${ext}`)) n += 1
        name = `${stem}-${n}${ext}`
      }
      usedNames.add(name)
      entries[name] = buffer
    }

    const zipped = zipSync(entries, { level: 0 })
    const blob = new Blob([zipped], { type: "application/zip" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "shrinkcord-discord.zip"
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const videoDisabledMessage = videoApiEnabled ? null : VIDEO_API_DISABLED_MESSAGE

  return (
    <div
      id="shrink"
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-3 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] sm:p-4"
    >
      <MediaDropZone
        onFiles={(files) => void enqueueFiles(files)}
        videoDisabledMessage={videoDisabledMessage}
      />
      {classifyError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {classifyError}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul aria-live="polite" className="mt-3 grid gap-2">
          {items.map((item) => {
            const retryUi =
              item.kind === "video"
                ? videoRetryUiFlags({
                    kind: item.kind,
                    status: item.status,
                    canRetry: item.canRetry,
                    error: item.error,
                  })
                : { toolbar: false, errorPanel: false }
            return (
            <li
              key={item.id}
              className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[10px] border border-border bg-surface-2 p-2.5 sm:px-3"
            >
              <ResultThumb
                url={item.kind === "image" ? item.thumbUrl : undefined}
                name={item.file.name}
                file={item.file}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{item.file.name}</p>
                {item.kind === "image" ? (
                  <ImageItemMeta item={item} />
                ) : (
                  <VideoItemMeta item={item} />
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-center">
                {item.status === "done" && item.downloadUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={item.kind === "image" && item.result?.passthrough ? "outline" : "default"}
                    className="hidden sm:inline-flex"
                    onClick={() => downloadOne(item)}
                  >
                    Download
                  </Button>
                ) : null}
                {retryUi.toolbar ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => retryVideo(item.id)}>
                    Retry
                  </Button>
                ) : null}
                {item.kind === "video" && ["uploading", "server_busy", "job_queued", "processing", "downloading"].includes(item.status) ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void cancelVideo(item.id)}>
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removeItem(item.id)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              {item.status === "done" && item.downloadUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant={item.kind === "image" && item.result?.passthrough ? "outline" : "default"}
                  className="col-span-3 w-full sm:hidden"
                  onClick={() => downloadOne(item)}
                >
                  Download
                </Button>
              ) : null}
              {item.status === "error" && item.error ? (
                <div className="col-span-3 flex flex-wrap items-start gap-2 border-t border-border pt-2 text-[12.5px] text-destructive sm:col-start-2 sm:col-span-2" role="alert">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{item.error}</span>
                  {retryUi.errorPanel ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => retryVideo(item.id)}>
                      Retry
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {item.kind === "image" && item.result?.flattenedTransparency ? (
                <div className="col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2">
                  Saved as JPEG. Transparency was flattened onto white so the file could get under 19.5 MiB.
                </div>
              ) : item.kind === "image" && item.result?.convertedFromPng ? (
                <div className="col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2">
                  Saved as JPEG. PNG can&apos;t be shrunk with a quality setting, so it was converted.
                </div>
              ) : null}
              {item.status === "done" ? (
                <StorageResultNote
                  storageDownloadUrl={item.storageDownloadUrl}
                  storageExpiresAt={item.storageExpiresAt}
                  storageNotSaved={item.storageNotSaved}
                  storagePassthrough={item.kind === "image" ? item.storagePassthrough : false}
                />
              ) : null}
              {item.kind === "image" && item.result?.scaled && !item.result.missedTarget ? (
                <p className="col-span-3 border-t border-border pt-2 font-mono text-xs text-muted-foreground sm:col-start-2 sm:col-span-2">
                  Scaled to {item.result.width}×{item.result.height} after quality alone was still too big.
                </p>
              ) : null}
              {item.kind === "image" && item.result?.missedTarget ? (
                <div className="col-span-3 flex items-start gap-2 border-t border-border pt-2 text-[12.5px] text-destructive sm:col-start-2 sm:col-span-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Still over 19.5 MiB. Smallest the browser could make is {formatMegabytes(item.result.outputBytes)}.
                  </span>
                </div>
              ) : null}
            </li>
            )
          })}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <div className="mt-3 flex flex-col items-start justify-between gap-2 px-1 pt-1 text-[13px] text-muted-foreground sm:flex-row sm:items-center">
          <span>
            Files are saved with <code>-discord</code> in the name.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={clearAll}>
              Clear all
            </Button>
            {downloadable.length > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void downloadAll()}>
                Download all ({downloadable.length})
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ImageItemMeta({ item }: { item: ImageQueueItem }) {
  const progressValue = item.status === "working" ? Math.max(1, Math.round(item.progress)) : item.progress
  return (
    <>
      <div className="meta mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        {item.status === "done" && item.result && !item.result.passthrough ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <span className="text-ok-text" aria-hidden="true">→</span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatMegabytes(item.result.outputBytes)}
            </span>
            {item.storageUploadInProgress ? (
              <Badge variant="shrinking">Saving online · {Math.min(item.uploadProgress ?? 0, 99)}%</Badge>
            ) : (
              <Badge variant="ready">Ready</Badge>
            )}
          </>
        ) : null}
        {item.status === "done" && item.result?.passthrough ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <span>Already fits, unchanged</span>
          </>
        ) : null}
        {item.status === "queued" ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <Badge variant="queued">Queued</Badge>
          </>
        ) : null}
        {item.status === "working" ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <Badge variant="shrinking">Shrinking · {progressValue}%</Badge>
          </>
        ) : null}
        {item.status === "error" ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <Badge variant="destructive">Failed</Badge>
          </>
        ) : null}
        {item.status === "done" && item.result ? (
          <Badge variant="outline" className="hidden sm:inline-flex">{typeLabel(item.result.outputType)}</Badge>
        ) : null}
      </div>
      {item.status === "working" ? (
        <>
          <Progress value={progressValue} className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand" aria-label="Shrink progress" />
          <p className="sr-only" role="status">Shrinking {progressValue} percent</p>
        </>
      ) : null}
      {item.status === "done" && item.storageUploadInProgress ? (
        <>
          <Progress
            value={Math.min(item.uploadProgress ?? 0, 99)}
            className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand"
            aria-label="Online save progress"
          />
          <p className="sr-only" role="status">
            Saving online {Math.min(item.uploadProgress ?? 0, 99)} percent
          </p>
        </>
      ) : null}
    </>
  )
}

function VideoItemMeta({ item }: { item: VideoQueueItem }) {
  const uploadValue = Math.min(item.uploadProgress, 99)
  const compressValue = Math.min(item.compressProgress, 99)
  const downloadValue = Math.min(item.downloadProgress, 99)

  const snapshot =
    item.status === "uploading"
      ? videoProgressSnapshot({ phase: "uploading", uploadPercent: uploadValue, compressPercent: 0 })
      : item.status === "processing"
        ? videoProgressSnapshot({
            phase: "compressing",
            uploadPercent: 100,
            compressPercent: compressValue,
          })
        : item.status === "done"
          ? videoProgressSnapshot({
              phase: "completed",
              uploadPercent: 100,
              compressPercent: 100,
              completed: true,
            })
          : null

  const srProgress =
    item.status === "uploading"
      ? `Uploading ${uploadValue} percent`
      : item.status === "downloading"
        ? `Downloading ${downloadValue} percent`
        : item.status === "processing"
          ? `Compressing ${compressValue} percent`
          : snapshot
            ? snapshot.phase === "completed"
              ? "Video ready"
              : undefined
            : undefined

  return (
    <>
      <div className="meta mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
        {item.status === "done" && item.outputBytes !== undefined ? (
          <>
            <span className="text-ok-text" aria-hidden="true">→</span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatMegabytes(item.outputBytes)}
            </span>
            <Badge variant="ready">Ready</Badge>
          </>
        ) : null}
        {item.status === "precheck" ? <Badge variant="queued">Checking…</Badge> : null}
        {item.status === "queued" ? <Badge variant="queued">Queued</Badge> : null}
        {item.status === "server_busy" ? <Badge variant="shrinking">Server busy, retrying</Badge> : null}
        {item.status === "uploading" ? <Badge variant="shrinking">Uploading · {uploadValue}%</Badge> : null}
        {item.status === "job_queued" ? <Badge variant="queued">Queued on server</Badge> : null}
        {item.status === "processing" ? (
          <Badge variant="shrinking">Compressing · {compressValue}%</Badge>
        ) : null}
        {item.status === "downloading" ? <Badge variant="shrinking">Downloading · {downloadValue}%</Badge> : null}
        {item.status === "error" ? <Badge variant="destructive">Failed</Badge> : null}
        {item.status === "canceled" ? <Badge variant="outline">Canceled</Badge> : null}
      </div>
      {item.status === "uploading" ? (
        <>
          <Progress value={uploadValue} className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand" aria-label="Video upload progress" />
          <p className="sr-only" role="status">{srProgress}</p>
        </>
      ) : null}
      {item.status === "processing" ? (
        <>
          <Progress value={compressValue} className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand" aria-label="Video compression progress" />
          <p className="sr-only" role="status">{srProgress}</p>
        </>
      ) : null}
      {item.status === "downloading" ? (
        <>
          <Progress value={downloadValue} className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand" aria-label="Video download progress" />
          <p className="sr-only" role="status">{srProgress}</p>
        </>
      ) : null}
      {item.status === "server_busy" ? (
        <p className="sr-only" role="status">Server busy, retrying</p>
      ) : null}
    </>
  )
}
