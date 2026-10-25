import type { MutableRefObject } from "react"

import { classifyFileAsync } from "@/lib/fileClassification"
import { isShrinkcordCloudStorageConfigured } from "@/lib/api/shrinkcordApiUrl"
import { enqueueStorageSaveByFileName } from "@/lib/storage/shrinkcordStorageQueue"
import { isStorageUserAbort, uploadCompressedBlobToStorage } from "@/lib/storage/shrinkcordStorageUpload"
import { runShrink } from "@/lib/compression/runShrink"
import type { QueueLifecycle } from "./queueLifecycle"
import type { ImageQueueItem, QueueItem } from "./types"

export type ImageQueueContext = {
  itemsRef: MutableRefObject<QueueItem[]>
  imageRunning: MutableRefObject<boolean>
  imageStorageControllers: MutableRefObject<Map<string, AbortController>>
  urls: MutableRefObject<string[]>
  lifecycle: QueueLifecycle
  update: (id: string, patch: Partial<QueueItem>) => void
}

export type ImageQueueDependencies = {
  classifyFile: typeof classifyFileAsync
  runShrink: typeof runShrink
  isStorageEnabled: typeof isShrinkcordCloudStorageConfigured
  createObjectUrl: typeof URL.createObjectURL
  revokeObjectUrl: typeof URL.revokeObjectURL
}

const defaultDependencies: ImageQueueDependencies = {
  classifyFile: classifyFileAsync,
  runShrink,
  isStorageEnabled: isShrinkcordCloudStorageConfigured,
  createObjectUrl: URL.createObjectURL.bind(URL),
  revokeObjectUrl: URL.revokeObjectURL.bind(URL),
}

export async function drainImages(
  context: ImageQueueContext,
  dependencies: ImageQueueDependencies = defaultDependencies,
) {
  if (context.imageRunning.current) return
  const generation = context.lifecycle.capture()
  context.imageRunning.current = true
  try {
    while (context.lifecycle.isCurrent(generation) && context.itemsRef.current.some((item) => item.kind === "image" && item.status === "queued")) {
      const current = context.itemsRef.current.find(
        (item): item is ImageQueueItem => item.kind === "image" && item.status === "queued",
      )
      if (!current) break
      context.update(current.id, { status: "working", progress: 4 })

      let classified: Awaited<ReturnType<typeof classifyFileAsync>>
      try {
        classified = await dependencies.classifyFile(current.file)
      } catch (error) {
        if (!context.lifecycle.isCurrent(generation)) break
        if (!context.itemsRef.current.some((entry) => entry.id === current.id)) continue
        context.update(current.id, {
          status: "error",
          progress: 0,
          error: error instanceof Error ? error.message : "Could not inspect this image.",
        })
        continue
      }
      if (!context.lifecycle.isCurrent(generation)) break
      if (classified.kind !== "image") {
        context.update(current.id, { status: "error", progress: 0, error: "Use a JPEG, PNG, or WebP." })
        continue
      }

      try {
        const result = await dependencies.runShrink(current.file, (progress) => {
          if (!context.lifecycle.isCurrent(generation)) return
          if (!context.itemsRef.current.some((entry) => entry.id === current.id)) return
          context.update(current.id, { progress })
        })
        const downloadUrl = dependencies.createObjectUrl(result.blob)
        if (!context.lifecycle.isCurrent(generation)) {
          dependencies.revokeObjectUrl(downloadUrl)
          continue
        }
        const stillPresent = context.itemsRef.current.some((entry) => entry.id === current.id)
        if (!stillPresent) {
          dependencies.revokeObjectUrl(downloadUrl)
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

        const storageEnabled = dependencies.isStorageEnabled()
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
              if (!context.lifecycle.isCurrent(generation)) return
              if (!context.itemsRef.current.some((entry) => entry.id === current.id)) return
              context.update(current.id, { uploadProgress: percent, storageUploadInProgress: true })
            },
          }),
        )
          .then((storage) => {
            if (context.imageStorageControllers.current.get(current.id) === controller) {
              context.imageStorageControllers.current.delete(current.id)
            }
            if (!context.lifecycle.isCurrent(generation)) return
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
            if (context.imageStorageControllers.current.get(current.id) === controller) {
              context.imageStorageControllers.current.delete(current.id)
            }
            if (isStorageUserAbort(error)) return
            if (!context.lifecycle.isCurrent(generation)) return
            if (!context.itemsRef.current.some((entry) => entry.id === current.id)) return
            context.update(current.id, {
              storageNotSaved: true,
              storageUploadInProgress: false,
            })
          })
      } catch (error) {
        if (!context.lifecycle.isCurrent(generation)) continue
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
    if (context.lifecycle.isAlive() && context.itemsRef.current.some((item) => item.kind === "image" && item.status === "queued")) {
      void drainImages(context)
    }
  }
}
