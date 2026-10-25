import { validateVideoFile } from "@/lib/video/videoSelection"

export const MAX_VIDEO_DURATION_SECONDS = 600

export type VideoPrecheckResult =
  | { ok: true; durationSeconds: number | null }
  | { ok: false; code: "empty" | "too_large" | "too_long" | "unsupported"; message: string }

/**
 * Reads duration via `<video preload="metadata">`. If the browser cannot decode
 * the file (e.g. HEVC in Chrome), returns ok with null duration so upload can proceed.
 */
export function probeVideoDuration(file: File, timeoutMs = 12_000): Promise<VideoPrecheckResult> {
  const validationError = validateVideoFile(file)
  if (validationError) {
    const code = validationError.includes("empty")
      ? "empty"
      : validationError.includes("524.288")
        ? "too_large"
        : "unsupported"
    return Promise.resolve({ ok: false, code, message: validationError })
  }

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
