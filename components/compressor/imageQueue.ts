import type { MutableRefObject } from "react"

import { classifyFileAsync } from "@/lib/file-classification"
import { isShrinkcordCloudStorageConfigured } from "@/lib/shrinkcord-api-url"
import { enqueueStorageSaveByFileName } from "@/lib/shrinkcord-storage-queue"
import { isStorageUserAbort, uploadCompressedBlobToStorage } from "@/lib/shrinkcord-storage-upload"
import { runShrink } from "@/lib/run-shrink"
import type { ImageQueueItem, QueueItem } from "./types"

export type ImageQueueContext = {
  itemsRef: MutableRefObject<QueueItem[]>
  imageRunning: MutableRefObject<boolean>
  imageStorageControllers: MutableRefObject<Map<string, AbortController>>
  urls: MutableRefObject<string[]>
  update: (id: string, patch: Partial<QueueItem>) => void
}

export async function drainImages(context: ImageQueueContext) {
  if (context.imageRunning.current) return
  context.imageRunning.current = true
  try {
    while (context.itemsRef.current.some((item) => item.kind === "image" && item.status === "queued")) {
      const current = context.itemsRef.current.find(
        (item): item is ImageQueueItem => item.kind === "image" && item.status === "queued",
      )
      if (!current) break
      context.update(current.id, { status: "working", progress: 4 })

      const classified = await classifyFileAsync(current.file)
      if (classified.kind !== "image") {
        context.update(current.id, { status: "error", progress: 0, error: "Use a JPEG, PNG, or WebP." })
        continue
      }

      try {
        const result = await runShrink(current.file, (progress) => {
          if (!context.itemsRef.current.some((entry) => entry.id === current.id)) return
          context.update(current.id, { progress })
        })
        const downloadUrl = URL.createObjectURL(result.blob)
        const stillPresent = context.itemsRef.current.some((entry) => entry.id === current.id)
        if (!stillPresent) {
          URL.revokeObjectURL(downloadUrl)
          continue
        }
        context.urls.current.push(downloadUrl)

        if (result.passthrough) {
          context.update(current.id, {
            status: "done",
            progress: 100,
            result,
            downloadUrl,
            storagePassthrough: true,
          })
          continue
        }

        const storageEnabled = isShrinkcordCloudStorageConfigured()
        context.update(current.id, {
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
        context.imageStorageControllers.current.set(current.id, controller)
        void enqueueStorageSaveByFileName(result.fileName, () =>
          uploadCompressedBlobToStorage({
            blob: result.blob,
            fileName: result.fileName,
            contentType: result.outputType,
            signal: controller.signal,
            onProgress: (percent) => {
              if (!context.itemsRef.current.some((entry) => entry.id === current.id)) return
              context.update(current.id, { uploadProgress: percent, storageUploadInProgress: true })
            },
          }),
        )
          .then((storage) => {
            context.imageStorageControllers.current.delete(current.id)
            if (!context.itemsRef.current.some((entry) => entry.id === current.id)) return
            if (storage.ok) {
              context.update(current.id, {
                storageDownloadUrl: storage.downloadUrl,
                storageExpiresAt: storage.expiresAt,
                storageNotSaved: false,
                storageUploadInProgress: false,
                uploadProgress: 100,
              })
            } else {
              context.update(current.id, {
                storageNotSaved: true,
                storageUploadInProgress: false,
                uploadProgress: 100,
              })
            }
          })
          .catch((error) => {
            context.imageStorageControllers.current.delete(current.id)
            if (isStorageUserAbort(error)) return
            if (!context.itemsRef.current.some((entry) => entry.id === current.id)) return
            context.update(current.id, {
              storageNotSaved: true,
              storageUploadInProgress: false,
            })
          })
      } catch (error) {
        if (!context.itemsRef.current.some((entry) => entry.id === current.id)) continue
        context.update(current.id, {
          status: "error",
          progress: 0,
          error: error instanceof Error ? error.message : "Could not shrink this image.",
        })
      }
    }
  } finally {
    context.imageRunning.current = false
  }
}
