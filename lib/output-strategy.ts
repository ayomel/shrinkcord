/**
 * Prefer a transparent WebP that already fits the budget over flattening to JPEG.
 * Keeping alpha wins even when a flattened JPEG could stay sharper at full size.
 */
export function preferTransparentWebp(result: {
  candidate: { size: number } | null
  missedTarget: boolean
}): boolean {
  return Boolean(result.candidate && !result.missedTarget)
}
