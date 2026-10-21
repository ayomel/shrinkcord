import { formatStorageAvailabilityLabel } from "@/lib/shrinkcord-storage-url"

export const STORAGE_NOT_SAVED_NOTE =
  "Not saved online. You can still download from this browser tab."
export const STORAGE_ALREADY_FITS_NOTE = "Already fits, not saved online."

export type StorageResultPresentation =
  | { kind: "saved"; downloadUrl: string; availabilityLabel: string }
  | { kind: "not_saved"; note: string }

export function buildStorageResultPresentation(input: {
  storageDownloadUrl?: string | null
  storageExpiresAt?: string | null
  storageNotSaved?: boolean
  storagePassthrough?: boolean
}): StorageResultPresentation | null {
  if (input.storagePassthrough) {
    return { kind: "not_saved", note: STORAGE_ALREADY_FITS_NOTE }
  }
  if (input.storageDownloadUrl?.trim()) {
    const availabilityLabel = input.storageExpiresAt
      ? formatStorageAvailabilityLabel(input.storageExpiresAt)
      : "Available until link expires"
    return {
      kind: "saved",
      downloadUrl: input.storageDownloadUrl.trim(),
      availabilityLabel,
    }
  }
  if (input.storageNotSaved) {
    return { kind: "not_saved", note: STORAGE_NOT_SAVED_NOTE }
  }
  return null
}
