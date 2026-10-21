"use client"

import { MediaDropZone } from "@/components/media-drop-zone"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { type ShrinkResult, typeLabel } from "@/lib/compress"
import { classifyFileAsync, type FileKind } from "@/lib/file-classification"
import { acceptedType, formatMegabytes } from "@/lib/limits"
import { runShrink } from "@/lib/run-shrink"
import { cancelShrinkcordJob, ShrinkcordApiError } from "@/lib/shrinkcord-api-client"
import { getVideoOutputFileName, fetchVideoJobOutput } from "@/lib/video-job-output"
import { monitorVideoJob } from "@/lib/video-job-monitor"
import { videoProgressSnapshot } from "@/lib/video-progress"
import { probeVideoDuration } from "@/lib/video-precheck"
import { createVideoJobAttempt, submitVideoJob } from "@/lib/video-jobs"
import { DEFAULT_VIDEO_TARGET_BYTES } from "@/lib/video-selection"
import { zipSync } from "fflate"
import { AlertCircle, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"

type ImageItemStatus = "queued" | "working" | "done" | "error"

type ImageQueueItem = {
  kind: "image"
  id: string
  file: File
  status: ImageItemStatus
  progress: number
  error?: string
  result?: ShrinkResult
  downloadUrl?: string
  thumbUrl?: string
}

type VideoItemStatus =
  | "precheck"
  | "queued"
  | "uploading"
  | "processing"
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
  error?: string
  jobId?: string
  outputBytes?: number
  downloadUrl?: string
}

type QueueItem = ImageQueueItem | VideoQueueItem

function ResultThumb({ url, name, kind }: { url?: string; name: string; kind: FileKind }) {
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
  if (kind === "video") {
    return (
      <div
        className="size-11 shrink-0 rounded-lg bg-[#1a1c22] grid place-items-center text-[10px] font-semibold uppercase text-muted-foreground"
        aria-hidden="true"
      >
        MP4
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

function mapVideoApiError(error: unknown): string {
  if (error instanceof ShrinkcordApiError) return error.message
  if (error instanceof DOMException && error.name === "AbortError") return "Canceled."
  if (error instanceof Error) return error.message
  return "Could not process this video. Try again."
}

export function Compressor() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [classifyError, setClassifyError] = useState<string | null>(null)
  const itemsRef = useRef<QueueItem[]>([])
  const imageRunning = useRef(false)
  const videoRunning = useRef(false)
  const urls = useRef<string[]>([])
  const videoControllers = useRef<Map<string, AbortController>>(new Map())

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

        if (!acceptedType(current.file)) {
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
          update(current.id, { status: "done", progress: 100, result, downloadUrl })
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

  const processVideo = async (itemId: string) => {
    const item = itemsRef.current.find(
      (entry): entry is VideoQueueItem => entry.kind === "video" && entry.id === itemId,
    )
    if (!item || item.status !== "queued") return

    const controller = new AbortController()
    videoControllers.current.set(itemId, controller)
    update(itemId, { status: "uploading", uploadProgress: 0, compressProgress: 0 })

    const attempt = createVideoJobAttempt(item.file, DEFAULT_VIDEO_TARGET_BYTES)
    try {
      const { jobId } = await submitVideoJob({
        file: item.file,
        targetSizeBytes: DEFAULT_VIDEO_TARGET_BYTES,
        attempt,
        signal: controller.signal,
        onProgress: (percent) => update(itemId, { uploadProgress: percent }),
      })
      if (!itemsRef.current.some((entry) => entry.id === itemId)) return
      update(itemId, { jobId, status: "processing", uploadProgress: 100, compressProgress: 0 })

      const terminal = await monitorVideoJob(jobId, {
        signal: controller.signal,
        pollIntervalMs: 2_000,
        onJob: (job) => {
          update(itemId, {
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

      const output = await fetchVideoJobOutput(jobId, { signal: controller.signal })
      const downloadUrl = URL.createObjectURL(output.blob)
      urls.current.push(downloadUrl)
      update(itemId, {
        status: "done",
        compressProgress: 100,
        outputBytes: output.bytes,
        downloadUrl,
      })
    } catch (error) {
      if (!itemsRef.current.some((entry) => entry.id === itemId)) return
      if (error instanceof DOMException && error.name === "AbortError") {
        update(itemId, { status: "canceled" })
        return
      }
      update(itemId, { status: "error", error: mapVideoApiError(error) })
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
    const rejected: string[] = []
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
        const id = crypto.randomUUID()
        newVideos.push({
          kind: "video",
          id,
          file,
          status: "precheck",
          uploadProgress: 0,
          compressProgress: 0,
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
        rejected.push(file.name)
      }
    }

    if (rejected.length) {
      setClassifyError(`${rejected.join(", ")} is not a supported image or video.`)
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

  const removeItem = (id: string) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (!target) return
    const controller = videoControllers.current.get(id)
    controller?.abort()
    videoControllers.current.delete(id)
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
    const controller = videoControllers.current.get(id)
    if (controller) {
      controller.abort()
      return
    }
    if (target.jobId && (target.status === "processing" || target.status === "uploading")) {
      try {
        await cancelShrinkcordJob(target.jobId)
        update(id, { status: "canceled" })
      } catch {
        update(id, { error: "Cancellation could not be confirmed. Status may still update." })
      }
    }
  }

  const clearAll = () => {
    for (const controller of videoControllers.current.values()) controller.abort()
    videoControllers.current.clear()
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

  return (
    <div
      id="shrink"
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-3 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] sm:p-4"
    >
      <MediaDropZone onFiles={(files) => void enqueueFiles(files)} />
      {classifyError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {classifyError}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul aria-live="polite" className="mt-3 grid gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[10px] border border-border bg-surface-2 p-2.5 sm:px-3"
            >
              <ResultThumb
                url={item.kind === "image" ? item.thumbUrl : undefined}
                name={item.file.name}
                kind={item.kind}
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
                {item.kind === "video" && (item.status === "uploading" || item.status === "processing") ? (
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
                <div className="col-span-3 flex items-start gap-2 border-t border-border pt-2 text-[12.5px] text-destructive sm:col-start-2 sm:col-span-2" role="alert">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{item.error}</span>
                </div>
              ) : null}
              {item.kind === "image" && item.result?.flattenedTransparency ? (
                <div className="col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2">
                  Saved as JPEG. Transparency was flattened onto white so the file could get under 19.5 MB.
                </div>
              ) : item.kind === "image" && item.result?.convertedFromPng ? (
                <div className="col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2">
                  Saved as JPEG. PNG can&apos;t be shrunk with a quality setting, so it was converted.
                </div>
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
                    Still over 19.5 MB. Smallest the browser could make is {formatMegabytes(item.result.outputBytes)}.
                  </span>
                </div>
              ) : null}
            </li>
          ))}
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
            <Badge variant="ready">Ready</Badge>
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
            <Badge variant="shrinking">Shrinking · {Math.max(1, Math.round(item.progress))}%</Badge>
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
        <Progress
          value={item.progress}
          className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand"
          aria-label="Shrink progress"
        />
      ) : null}
    </>
  )
}

function VideoItemMeta({ item }: { item: VideoQueueItem }) {
  const snapshot =
    item.status === "uploading"
      ? videoProgressSnapshot({ phase: "uploading", uploadPercent: item.uploadProgress, compressPercent: 0 })
      : item.status === "processing"
        ? videoProgressSnapshot({
            phase: "compressing",
            uploadPercent: 100,
            compressPercent: item.compressProgress,
          })
        : item.status === "done"
          ? videoProgressSnapshot({
              phase: "completed",
              uploadPercent: 100,
              compressPercent: 100,
              completed: true,
            })
          : null

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
        {item.status === "uploading" ? <Badge variant="shrinking">Uploading · {item.uploadProgress}%</Badge> : null}
        {item.status === "processing" ? (
          <Badge variant="shrinking">Compressing · {Math.min(item.compressProgress, 99)}%</Badge>
        ) : null}
        {item.status === "error" ? <Badge variant="destructive">Failed</Badge> : null}
        {item.status === "canceled" ? <Badge variant="outline">Canceled</Badge> : null}
      </div>
      {item.status === "uploading" ? (
        <Progress
          value={item.uploadProgress}
          className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand"
          aria-label="Video upload progress"
        />
      ) : null}
      {item.status === "processing" ? (
        <Progress
          value={Math.min(item.compressProgress, 99)}
          className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand"
          aria-label="Video compression progress"
        />
      ) : null}
      {snapshot ? (
        <p className="sr-only" role="status">
          {snapshot.phase === "uploading"
            ? `Upload ${snapshot.uploadPercent} percent`
            : snapshot.phase === "compressing"
              ? `Compress ${snapshot.compressPercent} percent`
              : "Video ready"}
        </p>
      ) : null}
    </>
  )
}
