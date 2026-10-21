import { MAX_VIDEO_BYTES } from "@/lib/video-selection"

export const MAX_VIDEO_DURATION_SECONDS = 600

export type VideoPrecheckResult =
  | { ok: true; durationSeconds: number | null }
  | { ok: false; code: "empty" | "too_large" | "too_long" | "unsupported"; message: string }

export function precheckVideoSize(file: Pick<File, "size">): VideoPrecheckResult | null {
  if (file.size <= 0) {
    return { ok: false, code: "empty", message: "This video file is empty. Choose a non-empty MP4 or MOV." }
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: "Choose a video that is 524.288 MB (500 MiB) or smaller.",
    }
  }
  return null
}

/**
 * Reads duration via `<video preload="metadata">`. If the browser cannot decode
 * the file (e.g. HEVC in Chrome), returns ok with null duration so upload can proceed.
 */
export function probeVideoDuration(file: File, timeoutMs = 12_000): Promise<VideoPrecheckResult> {
  const sizeError = precheckVideoSize(file)
  if (sizeError) return Promise.resolve(sizeError)

  if (typeof document === "undefined") {
    return Promise.resolve({ ok: true, durationSeconds: null })
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    video.preload = "metadata"
    video.muted = true
    video.playsInline = true

    let settled = false
    const finish = (result: VideoPrecheckResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ ok: true, durationSeconds: null })
    }, timeoutMs)

    video.addEventListener("loadedmetadata", () => {
      const duration = video.duration
      if (!Number.isFinite(duration) || duration <= 0) {
        finish({ ok: true, durationSeconds: null })
        return
      }
      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        finish({
          ok: false,
          code: "too_long",
          message: "Choose a video that is 10 minutes or shorter.",
        })
        return
      }
      finish({ ok: true, durationSeconds: duration })
    })

    video.addEventListener("error", () => {
      finish({ ok: true, durationSeconds: null })
    })

    video.src = url
  })
}
