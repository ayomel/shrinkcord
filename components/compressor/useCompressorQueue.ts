"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { formatDropClassifyErrors, type DropRejection } from "@/lib/dropRejectionMessages"
import { classifyFileAsync } from "@/lib/fileClassification"
import { probeVideoDuration } from "@/lib/video/videoPrecheck"
import { isShrinkcordVideoApiConfigured, VIDEO_API_DISABLED_MESSAGE } from "@/lib/api/shrinkcordApiUrl"
import { createVideoJobAttempt } from "@/lib/video/videoJobs"
import { drainImages } from "./imageQueue"
import type { ImageQueueContext } from "./imageQueue"
import { downloadAll as downloadQueue } from "./downloadQueue"
import { makeThumbUrl, revokeTracked } from "./thumbnail"
import { drainVideos, stopVideoWork } from "./videoQueue"
import type { VideoQueueContext } from "./videoQueue"
import type { ImageQueueItem, QueueItem, VideoQueueItem } from "./types"
import { classifyQueueFiles, commitQueueItems, createQueueLifecycle } from "./queueLifecycle"

const videoApiEnabled = isShrinkcordVideoApiConfigured()

export function useCompressorQueue() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [classifyError, setClassifyError] = useState<string | null>(null)
  const [downloadAllError, setDownloadAllError] = useState<string | null>(null)
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const downloadAllController = useRef<AbortController | null>(null)
  const itemsRef = useRef<QueueItem[]>([])
  const imageRunning = useRef(false)
  const videoRunning = useRef(false)
  const urls = useRef<string[]>([])
  const videoControllers = useRef<Map<string, AbortController>>(new Map())
  const imageStorageControllers = useRef<Map<string, AbortController>>(new Map())
  const videoAttempts = useRef<Map<string, ReturnType<typeof createVideoJobAttempt>>>(new Map())
  const [lifecycle] = useState(createQueueLifecycle)

  const update = useCallback((id: string, patch: Partial<QueueItem>) => {
    if (!lifecycle.isAlive()) return
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === id ? { ...item, ...patch } as QueueItem : item,
    )
    setItems([...itemsRef.current])
  }, [lifecycle])

  const imageContext = useMemo<ImageQueueContext>(() => ({
    itemsRef,
    imageRunning,
    imageStorageControllers,
    urls,
    lifecycle,
    update,
  }), [lifecycle, update])
  const videoContext = useMemo<VideoQueueContext>(() => ({
    itemsRef,
    videoRunning,
    videoControllers,
    videoAttempts,
    urls,
    lifecycle,
    update,
  }), [lifecycle, update])

  useEffect(() => {
    lifecycle.activate()
    const trackedArchive = downloadAllController
    const trackedUrlsRef = urls
    const trackedVideoControllers = videoControllers.current
    const trackedImageControllers = imageStorageControllers.current
    const trackedVideoAttempts = videoAttempts.current
    const trackedItemsRef = itemsRef
    return () => {
      lifecycle.dispose()
      trackedArchive.current?.abort()
      trackedArchive.current = null
      for (const controller of trackedVideoControllers.values()) controller.abort()
      for (const controller of trackedImageControllers.values()) controller.abort()
      for (const item of trackedItemsRef.current) {
        if (item.kind === "video") void stopVideoWork(videoContext, item)
      }
      trackedVideoControllers.clear()
      trackedImageControllers.clear()
      trackedVideoAttempts.clear()
      for (const url of trackedUrlsRef.current) URL.revokeObjectURL(url)
      trackedUrlsRef.current = []
    }
  }, [lifecycle, videoContext])

  const enqueueFiles = async (files: File[]) => {
    const generation = lifecycle.capture()
    setClassifyError(null)
    const rejections: DropRejection[] = []
    const newImages: ImageQueueItem[] = []
    const newVideos: VideoQueueItem[] = []
    const classifiedBatch = await classifyQueueFiles(
      files,
      classifyFileAsync,
      () => lifecycle.isCurrent(generation),
    )
    if (!lifecycle.isCurrent(generation)) return
    const classifyFailures = classifiedBatch.failed.map(
      (file) => `Could not inspect ${file.name}. Try adding it again.`,
    )

    for (const { file, classification: classified } of classifiedBatch.results) {
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
      } else {
        rejections.push({ kind: "wrong-type", fileName: file.name })
      }
    }

    const rejectionMessage = formatDropClassifyErrors(rejections, videoApiEnabled)
    const classifyErrorMessage = [rejectionMessage, ...classifyFailures].filter(Boolean).join(" ")
    if (classifyErrorMessage) {
      setClassifyError(classifyErrorMessage)
    }

    if (newImages.length === 0 && newVideos.length === 0) return

    commitQueueItems(itemsRef, setItems, [...newImages, ...newVideos], () => {
      for (const item of newVideos) {
        void (async () => {
          try {
            const precheck = await probeVideoDuration(item.file)
            if (!lifecycle.isCurrent(generation)) return
            const current = itemsRef.current.find((entry) => entry.id === item.id)
            if (!current || current.status !== "precheck") return
            if (!precheck.ok) {
              update(item.id, { status: "error", error: precheck.message })
              return
            }
            update(item.id, { status: "queued" })
            void drainVideos(videoContext)
          } catch (error) {
            if (!lifecycle.isCurrent(generation)) return
            const current = itemsRef.current.find((entry) => entry.id === item.id)
            if (!current || current.status !== "precheck") return
            update(item.id, {
              status: "error",
              error: error instanceof Error ? error.message : "Could not inspect this video.",
            })
          }
        })()
      }
    })

    for (const item of newImages) {
      void makeThumbUrl(item.file).then((thumbUrl) => {
        if (!thumbUrl) return
        if (!lifecycle.isCurrent(generation)) {
          URL.revokeObjectURL(thumbUrl)
          return
        }
        if (!itemsRef.current.some((entry) => entry.id === item.id)) {
          URL.revokeObjectURL(thumbUrl)
          return
        }
        urls.current.push(thumbUrl)
        update(item.id, { thumbUrl })
      })
    }

    void drainImages(imageContext)
    void drainVideos(videoContext)
  }

  const stopImageStorage = (id: string) => {
    imageStorageControllers.current.get(id)?.abort()
    imageStorageControllers.current.delete(id)
  }

  const cancelDownloadAll = () => {
    downloadAllController.current?.abort()
    downloadAllController.current = null
    setIsDownloadingAll(false)
    setDownloadAllError(null)
  }

  const removeItem = (id: string) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (!target) return
    cancelDownloadAll()
    if (target.kind === "image") stopImageStorage(id)
    if (target.kind === "video") void stopVideoWork(videoContext, target)
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
    update(id, { status: "canceled" })
    await stopVideoWork(videoContext, target)
  }

  const retryVideo = (id: string) => {
    videoAttempts.current.delete(id)
    update(id, { status: "queued", error: undefined, canRetry: false })
    void drainVideos(videoContext)
  }

  const clearAll = () => {
    cancelDownloadAll()
    lifecycle.invalidate()
    for (const item of itemsRef.current) {
      if (item.kind === "image") stopImageStorage(item.id)
      if (item.kind === "video") void stopVideoWork(videoContext, item)
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

  const downloadable = items.filter((item) => item.status === "done" && item.downloadUrl)

  const downloadAll = async () => {
    if (downloadAllController.current || downloadable.length === 0) return
    const generation = lifecycle.capture()
    const controller = new AbortController()
    downloadAllController.current = controller
    setIsDownloadingAll(true)
    setDownloadAllError(null)
    try {
      await downloadQueue(downloadable, { signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted || !lifecycle.isCurrent(generation)) return
      setDownloadAllError(error instanceof Error ? error.message : "Could not prepare the ZIP. Try downloading files individually.")
    } finally {
      if (downloadAllController.current === controller) {
        downloadAllController.current = null
        if (lifecycle.isAlive()) setIsDownloadingAll(false)
      }
    }
  }

  return {
    items,
    classifyError,
    downloadAllError,
    isDownloadingAll,
    videoDisabledMessage: videoApiEnabled ? null : VIDEO_API_DISABLED_MESSAGE,
    enqueueFiles,
    removeItem,
    cancelVideo,
    retryVideo,
    clearAll,
    downloadable,
    downloadAll,
  }
}
