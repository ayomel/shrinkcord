import {
  formatStorageAvailabilityLabel,
  isStorageLinkExpired,
} from "@/lib/shrinkcordStorageUrl"

export const STORAGE_LINK_EXPIRED_NOTE = "Link expired"

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
  now?: Date
}): StorageResultPresentation | null {
  const now = input.now ?? new Date()
  if (input.storagePassthrough) {
    return { kind: "not_saved", note: STORAGE_ALREADY_FITS_NOTE }
  }
  if (input.storageDownloadUrl?.trim()) {
    if (input.storageExpiresAt && isStorageLinkExpired(input.storageExpiresAt, now)) {
      return { kind: "not_saved", note: STORAGE_LINK_EXPIRED_NOTE }
    }
    const availabilityLabel = input.storageExpiresAt
      ? formatStorageAvailabilityLabel(input.storageExpiresAt, now)
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
