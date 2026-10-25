"use client"

import { MediaDropZone } from "@/components/MediaDropZone"
import { Button } from "@/components/ui/Button"
import { CompressorQueueRow } from "./compressor/compressorQueueRow"
import { downloadOne } from "./compressor/downloadQueue"
import { useCompressorQueue } from "./compressor/useCompressorQueue"

export function Compressor() {
  const queue = useCompressorQueue()

  return (
    <div
      id="shrink"
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-3 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] sm:p-4"
    >
      <MediaDropZone
        onFiles={(files) => void queue.enqueueFiles(files)}
        videoDisabledMessage={queue.videoDisabledMessage}
      />
      {queue.classifyError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {queue.classifyError}
        </p>
      ) : null}
      {queue.downloadAllError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {queue.downloadAllError}
        </p>
      ) : null}
      {queue.items.length > 0 ? (
        <ul aria-live="polite" className="mt-3 grid gap-2">
          {queue.items.map((item) => (
            <CompressorQueueRow
              key={item.id}
              item={item}
              onDownload={downloadOne}
              onRetry={queue.retryVideo}
              onCancel={queue.cancelVideo}
              onRemove={queue.removeItem}
            />
          ))}
        </ul>
      ) : null}
      {queue.items.length > 0 ? (
        <div className="mt-3 flex flex-col items-start justify-between gap-2 px-1 pt-1 text-[13px] text-muted-foreground sm:flex-row sm:items-center">
          <span>
            Files are saved with <code>-discord</code> in the name.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={queue.clearAll}>
              Clear all
            </Button>
            {queue.downloadable.length > 0 ? (
              <Button type="button" size="sm" variant="outline" disabled={queue.isDownloadingAll} aria-busy={queue.isDownloadingAll} onClick={() => void queue.downloadAll()}>
                {queue.isDownloadingAll ? "Preparing ZIP..." : `Download all (${queue.downloadable.length})`}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
