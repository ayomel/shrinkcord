export type DropRejection =
  | { kind: "wrong-type"; fileName: string }
  | { kind: "video-unavailable"; fileName: string }

export function acceptedTypesLabel(videoApiEnabled: boolean): string {
  if (videoApiEnabled) return "JPEG, PNG, WebP, MP4, or MOV"
  return "JPEG, PNG, or WebP"
}

export function wrongTypeRejectionMessage(fileNames: string[], videoApiEnabled: boolean): string {
  const names = fileNames.join(", ")
  return `Could not add ${names}. Choose a ${acceptedTypesLabel(videoApiEnabled)} file.`
}

export function videoUnavailableRejectionMessage(fileNames: string[]): string {
  const names = fileNames.join(", ")
  return `Could not add ${names}. Video upload is unavailable on this site; images still work in your browser.`
}

/** User-facing notice for one or more rejected drops (may combine two message kinds). */
export function formatDropClassifyErrors(
  rejections: DropRejection[],
  videoApiEnabled: boolean,
): string | null {
  if (rejections.length === 0) return null

  const wrongTypeNames = rejections
    .filter((entry): entry is DropRejection & { kind: "wrong-type" } => entry.kind === "wrong-type")
    .map((entry) => entry.fileName)
  const videoNames = rejections
    .filter(
      (entry): entry is DropRejection & { kind: "video-unavailable" } =>
        entry.kind === "video-unavailable",
    )
    .map((entry) => entry.fileName)

  const parts: string[] = []
  if (wrongTypeNames.length > 0) {
    parts.push(wrongTypeRejectionMessage(wrongTypeNames, videoApiEnabled))
  }
  if (videoNames.length > 0) {
    parts.push(videoUnavailableRejectionMessage(videoNames))
  }
  return parts.join(" ")
}
