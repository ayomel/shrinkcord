export const MAX_VIDEO_BYTES = 500 * 1024 * 1024
export const MAX_VIDEO_TARGET_MB = MAX_VIDEO_BYTES / 1_000_000
export const DEFAULT_VIDEO_TARGET_BYTES = 20_000_000

export type VideoFileInfo = Pick<File, "name" | "type" | "size">

export function validateVideoFile(file: VideoFileInfo): string | null {
  if (file.size <= 0) return "This video file is empty. Choose a non-empty MP4 or MOV."
  if (file.size > MAX_VIDEO_BYTES) return "Choose a video that is 524.288 MB (500 MiB) or smaller."

  const isMp4 = file.type === "video/mp4" || (file.type === "" && /\.mp4$/i.test(file.name))
  const isMov = file.type === "video/quicktime" || (file.type === "" && /\.mov$/i.test(file.name))
  if (!isMp4 && !isMov) return "Choose an MP4 or iPhone MOV video file."

  return null
}

export function parseVideoTarget(value: string): { bytes: number | null; error: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { bytes: null, error: "Enter a target size in MB." }

  const mb = Number(trimmed)
  if (!Number.isFinite(mb)) return { bytes: null, error: "Enter a finite number of MB." }
  if (mb <= 0) return { bytes: null, error: "Target size must be greater than 0 MB." }
  if (mb > MAX_VIDEO_TARGET_MB) {
    return { bytes: null, error: `Target size must be ${MAX_VIDEO_TARGET_MB} MB or less.` }
  }

  if (mb < 0.000001) return { bytes: null, error: "Target size must be at least 0.000001 MB (1 byte)." }

  const bytes = Math.round(mb * 1_000_000)
  if (bytes < 1) return { bytes: null, error: "Target size must be at least 0.000001 MB (1 byte)." }
  return { bytes, error: null }
}
