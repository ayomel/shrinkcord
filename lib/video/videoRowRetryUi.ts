export type VideoRetryRowState = {
  kind: "image" | "video"
  status: string
  canRetry?: boolean
  error?: string
}

/** At most one Retry control per queue row (toolbar vs error panel). */
export function videoRetryUiFlags(item: VideoRetryRowState): {
  toolbar: boolean
  errorPanel: boolean
} {
  const eligible = item.kind === "video" && item.canRetry === true
  if (!eligible) return { toolbar: false, errorPanel: false }
  const failed = item.status === "error" && Boolean(item.error)
  if (failed) return { toolbar: false, errorPanel: true }
  return { toolbar: true, errorPanel: false }
}

export function videoRetryButtonCount(item: VideoRetryRowState): number {
  const flags = videoRetryUiFlags(item)
  return (flags.toolbar ? 1 : 0) + (flags.errorPanel ? 1 : 0)
}
