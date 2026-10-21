import { buildStorageResultPresentation } from "@/lib/storage-result-copy"

type StorageResultNoteProps = {
  storageDownloadUrl?: string | null
  storageExpiresAt?: string | null
  storageNotSaved?: boolean
  storagePassthrough?: boolean
  className?: string
}

export function StorageResultNote({
  storageDownloadUrl,
  storageExpiresAt,
  storageNotSaved = false,
  storagePassthrough = false,
  className = "col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2",
}: StorageResultNoteProps) {
  const presentation = buildStorageResultPresentation({
    storageDownloadUrl,
    storageExpiresAt,
    storageNotSaved,
    storagePassthrough,
  })
  if (!presentation) return null

  if (presentation.kind === "saved") {
    return (
      <p className={className}>
        <a
          href={presentation.downloadUrl}
          className="font-medium text-brand-text underline-offset-2 hover:underline"
          rel="noopener noreferrer"
        >
          Storage download link
        </a>
        <span className="text-muted-foreground"> · {presentation.availabilityLabel}</span>
      </p>
    )
  }

  return <p className={className}>{presentation.note}</p>
}
