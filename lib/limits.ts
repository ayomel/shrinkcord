export const MIB = 1024 * 1024

/** Discord's free cap, in binary megabytes. */
export const DISCORD_FREE_LIMIT_BYTES = 20 * MIB

/** Stay under the cap with half a mebibyte of room. */
export const TARGET_BYTES = Math.floor(19.5 * MIB)

export const MIN_QUALITY = 0.5
export const MAX_QUALITY = 0.92
export const MIN_SHORT_EDGE = 480
export const SCALE_STEP = 0.9

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"])

export type AcceptedType = "image/jpeg" | "image/png" | "image/webp"

export function exceedsDiscordLimit(bytes: number) {
  return bytes > DISCORD_FREE_LIMIT_BYTES
}

export function acceptedType(file: Pick<File, "type" | "name">): AcceptedType | null {
  if (ACCEPTED.has(file.type)) return file.type as AcceptedType
  const ext = file.name.split(".").pop()?.toLowerCase()
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  return null
}

export function formatMegabytes(bytes: number) {
  if (bytes < 0.1 * MIB) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / MIB).toFixed(2)} MB`
}

export function outputFileName(original: string, type: string, passthrough: boolean) {
  if (passthrough) return original
  const base = original.replace(/\.[^/.]+$/, "") || "image"
  const ext = type === "image/webp" ? "webp" : "jpg"
  return `${base}-discord.${ext}`
}
