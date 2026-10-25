import { AlertCircle, X } from "lucide-react"

import { StorageResultNote } from "@/components/StorageResultNote"
import { Button } from "@/components/ui/Button"
import { formatMegabytes } from "@/lib/limits"
import { videoRetryUiFlags } from "@/lib/video-row-retry-ui"
import { ImageItemMeta } from "./ImageQueueItemMeta"
import { ResultThumb } from "./thumbnail"
import { VideoItemMeta } from "./VideoQueueItemMeta"
import type { QueueItem } from "./types"

type Props = {
  item: QueueItem
  onDownload: (item: QueueItem) => void
  onRetry: (id: string) => void
  onCancel: (id: string) => void | Promise<void>
  onRemove: (id: string) => void
}

export function CompressorQueueRow({ item, onDownload, onRetry, onCancel, onRemove }: Props) {
  const retryUi = item.kind === "video"
    ? videoRetryUiFlags({
        kind: item.kind,
        status: item.status,
        canRetry: item.canRetry,
        error: item.error,
      })
    : { toolbar: false, errorPanel: false }

  return (
    <li
      className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[10px] border border-border bg-surface-2 p-2.5 sm:px-3"
    >
      <ResultThumb
        url={item.kind === "image" ? item.thumbUrl : undefined}
        name={item.file.name}
        file={item.file}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{item.file.name}</p>
        {item.kind === "image" ? (
          <ImageItemMeta item={item} />
        ) : (
          <VideoItemMeta item={item} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-center">
        {item.status === "done" && item.downloadUrl ? (
          <Button
            type="button"
            size="sm"
            variant={item.kind === "image" && item.result?.passthrough ? "outline" : "default"}
            className="hidden sm:inline-flex"
            onClick={() => onDownload(item)}
          >
            Download
          </Button>
        ) : null}
        {retryUi.toolbar ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onRetry(item.id)}>
            Retry
          </Button>
        ) : null}
        {item.kind === "video" && ["uploading", "server_busy", "job_queued", "processing", "downloading"].includes(item.status) ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void onCancel(item.id)}>
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Remove ${item.file.name}`}
          onClick={() => onRemove(item.id)}
        >
          <X className="size-4" />
        </Button>
      </div>
      {item.status === "done" && item.downloadUrl ? (
        <Button
          type="button"
          size="sm"
          variant={item.kind === "image" && item.result?.passthrough ? "outline" : "default"}
          className="col-span-3 w-full sm:hidden"
          onClick={() => onDownload(item)}
        >
          Download
        </Button>
      ) : null}
      {item.status === "error" && item.error ? (
        <div className="col-span-3 flex flex-wrap items-start gap-2 border-t border-border pt-2 text-[12.5px] text-destructive sm:col-start-2 sm:col-span-2" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{item.error}</span>
          {retryUi.errorPanel ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onRetry(item.id)}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {item.kind === "image" && item.result?.flattenedTransparency ? (
        <div className="col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2">
          Saved as JPEG. Transparency was flattened onto white so the file could get under 19.5 MiB.
        </div>
      ) : item.kind === "image" && item.result?.convertedFromPng ? (
        <div className="col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2">
          Saved as JPEG. PNG can&apos;t be shrunk with a quality setting, so it was converted.
        </div>
      ) : null}
      {item.status === "done" ? (
        <StorageResultNote
          storageDownloadUrl={item.storageDownloadUrl}
          storageExpiresAt={item.storageExpiresAt}
          storageNotSaved={item.storageNotSaved}
          storagePassthrough={item.kind === "image" ? item.storagePassthrough : false}
        />
      ) : null}
      {item.kind === "image" && item.result?.scaled && !item.result.missedTarget ? (
        <p className="col-span-3 border-t border-border pt-2 font-mono text-xs text-muted-foreground sm:col-start-2 sm:col-span-2">
          Scaled to {item.result.width}×{item.result.height} after quality alone was still too big.
        </p>
      ) : null}
      {item.kind === "image" && item.result?.missedTarget ? (
        <div className="col-span-3 flex items-start gap-2 border-t border-border pt-2 text-[12.5px] text-destructive sm:col-start-2 sm:col-span-2">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Still over 19.5 MiB. Smallest the browser could make is {formatMegabytes(item.result.outputBytes)}.
          </span>
        </div>
      ) : null}
    </li>
  )
}
