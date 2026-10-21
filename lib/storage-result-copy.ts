export const STORAGE_AVAILABLE_LABEL = "Available for 7 days"
export const STORAGE_NOT_SAVED_NOTE =
  "Not saved online. You can still download from this browser tab."

export type StorageResultPresentation =
  | { kind: "saved"; downloadUrl: string; availabilityLabel: string }
  | { kind: "not_saved"; note: string }

export function buildStorageResultPresentation(input: {
  storageDownloadUrl?: string | null
  storageNotSaved?: boolean
}): StorageResultPresentation | null {
  if (input.storageDownloadUrl?.trim()) {
    return {
      kind: "saved",
      downloadUrl: input.storageDownloadUrl.trim(),
      availabilityLabel: STORAGE_AVAILABLE_LABEL,
    }
  }
  if (input.storageNotSaved) {
    return { kind: "not_saved", note: STORAGE_NOT_SAVED_NOTE }
  }
  return null
}
