/** Default API origin when developing against a local shrinkcord-api (`pnpm dev`). */
export const DEFAULT_DEV_SHRINKCORD_API_URL = "http://localhost:3000"

/** Production fallback when no public env var is set (matches Railway deployment). */
export const DEFAULT_PRODUCTION_SHRINKCORD_API_URL = "https://shrinkcord-api.up.railway.app"

export function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

/**
 * Browser-facing Shrinkcord API base URL (no trailing slash).
 * Set `NEXT_PUBLIC_SHRINKCORD_API_URL` in production; dev falls back to localhost:3000.
 */
export function getShrinkcordApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
  if (configured?.trim()) return normalizeApiBaseUrl(configured)
  if (process.env.NODE_ENV === "development") return DEFAULT_DEV_SHRINKCORD_API_URL
  return DEFAULT_PRODUCTION_SHRINKCORD_API_URL
}

export function shrinkcordApiUrl(path: string, baseUrl = getShrinkcordApiBaseUrl()): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${normalizeApiBaseUrl(baseUrl)}${normalizedPath}`
}
