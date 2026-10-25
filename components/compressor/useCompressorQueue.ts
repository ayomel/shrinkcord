"use client"

import { useCallback, useEffect, useRef, useState } from "react"

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

const videoApiEnabled = isShrinkcordVideoApiConfigured()

export function useCompressorQueue() {
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

  const imageContext: ImageQueueContext = {
    itemsRef,
    imageRunning,
    imageStorageControllers,
    urls,
    update,
  }
  const videoContext: VideoQueueContext = {
    itemsRef,
    videoRunning,
    videoControllers,
    videoAttempts,
    urls,
    update,
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
          void drainVideos(videoContext)
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

    void drainImages(imageContext)
    void drainVideos(videoContext)
  }

  const stopImageStorage = (id: string) => {
    imageStorageControllers.current.get(id)?.abort()
    imageStorageControllers.current.delete(id)
  }

  const removeItem = (id: string) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (!target) return
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
    await stopVideoWork(videoContext, target)
    update(id, { status: "canceled" })
  }

  const retryVideo = (id: string) => {
    videoAttempts.current.delete(id)
    update(id, { status: "queued", error: undefined, canRetry: false })
    void drainVideos(videoContext)
  }

  const clearAll = () => {
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

  return {
    items,
    classifyError,
    videoDisabledMessage: videoApiEnabled ? null : VIDEO_API_DISABLED_MESSAGE,
    enqueueFiles,
    removeItem,
    cancelVideo,
    retryVideo,
    clearAll,
    downloadable,
    downloadAll: () => downloadQueue(downloadable),
  }
}
