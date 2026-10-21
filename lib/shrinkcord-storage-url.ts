import { normalizeApiBaseUrl } from "@/lib/shrinkcord-api-url"

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Resolve storage URLs against the API origin when the server returns a relative path. */
export function resolveShrinkcordStorageUrl(url: string, apiBaseUrl: string): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return trimmed
  } catch {
    // relative URL
  }
  const base = normalizeApiBaseUrl(apiBaseUrl)
  return new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, `${base}/`).href
}

export function formatStorageAvailabilityLabel(expiresAt: string, now: Date = new Date()): string {
  const expiresMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresMs)) return "Available until link expires"

  const msLeft = expiresMs - now.getTime()
  if (msLeft <= 0) return "Link expired"

  if (msLeft < MS_PER_DAY) return "Available for less than a day"

  const wholeDays = Math.ceil(msLeft / MS_PER_DAY)
  if (wholeDays >= 2) return `Available for ${wholeDays} days`
  return "Available for 1 day"
}

export function isStorageLinkExpired(expiresAt: string, now: Date = new Date()): boolean {
  const expiresMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresMs)) return false
  return expiresMs <= now.getTime()
}
