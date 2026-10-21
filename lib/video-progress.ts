export type VideoWorkPhase = "uploading" | "compressing" | "completed"

export type VideoProgressSnapshot = {
  phase: VideoWorkPhase
  uploadPercent: number
  compressPercent: number
  /** Combined label percent for accessibility; never 100 until completed. */
  displayPercent: number
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * Encoding progress from the API is capped below 100 until status is COMPLETED.
 */
export function normalizeCompressProgress(status: string, apiProgress: number): number {
  const clamped = clampPercent(apiProgress)
  if (status === "COMPLETED") return 100
  return Math.min(clamped, 99)
}

export function videoProgressSnapshot(input: {
  phase: VideoWorkPhase
  uploadPercent: number
  compressPercent: number
  completed?: boolean
}): VideoProgressSnapshot {
  const uploadPercent = clampPercent(input.uploadPercent)
  const compressPercent = input.completed
    ? 100
    : clampPercent(input.compressPercent)

  let displayPercent: number
  if (input.phase === "uploading") {
    displayPercent = Math.min(uploadPercent, 99)
  } else if (input.phase === "compressing") {
    displayPercent = Math.min(compressPercent, 99)
  } else {
    displayPercent = 100
  }

  return {
    phase: input.completed ? "completed" : input.phase,
    uploadPercent,
    compressPercent,
    displayPercent,
  }
}
