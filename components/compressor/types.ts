import type { ShrinkResult } from "@/lib/compression/compress"

export type ImageItemStatus = "queued" | "working" | "done" | "error"

export type ImageQueueItem = {
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

export type VideoItemStatus =
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

export type VideoQueueItem = {
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

export type QueueItem = ImageQueueItem | VideoQueueItem
