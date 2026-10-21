export function getStorageLinkExpiryDelayMs(expiresAt: string, nowMs: number = Date.now()): number | null {
  const expiresMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresMs)) return null
  const delay = expiresMs - nowMs
  if (delay <= 0) return null
  return delay
}

/** Schedule one refresh at expires_at; returns a disposer cleared on unmount. */
export function scheduleStorageLinkExpiryRefresh(
  expiresAt: string,
  onExpiry: () => void,
  nowMs: number = Date.now(),
): () => void {
  const delay = getStorageLinkExpiryDelayMs(expiresAt, nowMs)
  if (delay === null) return () => {}
  const id = setTimeout(onExpiry, delay)
  return () => clearTimeout(id)
}
