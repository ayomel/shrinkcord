export type MeasuredBlob = {
  size: number
  quality: number
  blob?: Blob
}

export type QualitySearchResult = {
  bestFit: MeasuredBlob | null
  /** Smallest sample seen; usually the encode at or near min quality. */
  smallest: MeasuredBlob | null
  encodes: number
}

const DEFAULT_MIN_QUALITY = 0.5
const DEFAULT_MAX_QUALITY = 1
const DEFAULT_MAX_STEPS = 8
const DEFAULT_TOLERANCE = 0.02

/**
 * Binary-search an encode quality toward `targetBytes`.
 *
 * 1. Probe `maxQuality` (default 1.0) and return early if it already fits.
 * 2. Otherwise search `[minQuality, maxQuality]` for up to `maxSteps` encodes,
 *    stopping early when a fit is within `tolerance` of the target.
 */
export async function searchQualityBySize(
  measure: (quality: number) => Promise<MeasuredBlob>,
  targetBytes: number,
  options?: {
    minQuality?: number
    maxQuality?: number
    maxSteps?: number
    tolerance?: number
    onEncode?: () => void
  },
): Promise<QualitySearchResult> {
  const minQuality = options?.minQuality ?? DEFAULT_MIN_QUALITY
  const maxQuality = options?.maxQuality ?? DEFAULT_MAX_QUALITY
  const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS
  const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE
  const onEncode = options?.onEncode

  const state: {
    encodes: number
    bestFit: MeasuredBlob | null
    smallest: MeasuredBlob | null
  } = {
    encodes: 0,
    bestFit: null,
    smallest: null,
  }

  const sample = async (quality: number) => {
    const measured = await measure(quality)
    state.encodes += 1
    onEncode?.()
    if (!state.smallest || measured.size < state.smallest.size) {
      state.smallest = measured
    }
    if (measured.size <= targetBytes) {
      if (!state.bestFit || measured.size > state.bestFit.size) {
        state.bestFit = measured
      }
    }
    return measured
  }

  const top = await sample(maxQuality)
  if (top.size <= targetBytes) {
    return { bestFit: top, smallest: state.smallest, encodes: state.encodes }
  }

  let low = minQuality
  let high = maxQuality

  for (let step = 0; step < maxSteps; step += 1) {
    const quality = (low + high) / 2
    const measured = await sample(quality)

    if (measured.size <= targetBytes) {
      low = quality
      const ratio = measured.size / targetBytes
      if (ratio >= 1 - tolerance) break
    } else {
      high = quality
    }
  }

  if (
    !state.bestFit &&
    state.smallest &&
    state.smallest.quality > minQuality + 0.001
  ) {
    const floor = await sample(minQuality)
    if (floor.size <= targetBytes) state.bestFit = floor
  }

  return {
    bestFit: state.bestFit,
    smallest: state.smallest,
    encodes: state.encodes,
  }
}

/** Scale factor from a too-large encode, with a small safety margin. */
export function scaleForTarget(targetBytes: number, sizeAtCurrentScale: number) {
  if (sizeAtCurrentScale <= 0) return 1
  return Math.sqrt(targetBytes / sizeAtCurrentScale) * 0.97
}
