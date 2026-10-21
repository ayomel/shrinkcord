/** Default API origin when developing against a local shrinkcord-api (`pnpm dev`). */
export const DEFAULT_DEV_SHRINKCORD_API_URL = "http://localhost:3000"

export function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

/** True when the browser may send video jobs (explicit public URL or local dev). */
export function isShrinkcordVideoApiConfigured(): boolean {
  if (process.env.NEXT_PUBLIC_SHRINKCORD_API_URL?.trim()) return true
  return process.env.NODE_ENV === "development"
}

export const VIDEO_API_DISABLED_MESSAGE =
  "Video compression is not configured for this site. Set NEXT_PUBLIC_SHRINKCORD_API_URL. Images still work in your browser."

/**
 * Browser-facing Shrinkcord API base URL (no trailing slash).
 * In production, requires NEXT_PUBLIC_SHRINKCORD_API_URL (no silent Railway fallback).
 */
export function getShrinkcordApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
  if (configured?.trim()) return normalizeApiBaseUrl(configured)
  if (process.env.NODE_ENV === "development") return DEFAULT_DEV_SHRINKCORD_API_URL
  throw new Error("NEXT_PUBLIC_SHRINKCORD_API_URL is not configured")
}

export function shrinkcordApiUrl(path: string, baseUrl?: string): string {
  const base = baseUrl ?? getShrinkcordApiBaseUrl()
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${normalizeApiBaseUrl(base)}${normalizedPath}`
}
