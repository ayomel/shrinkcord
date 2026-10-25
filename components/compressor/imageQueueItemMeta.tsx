import { Badge } from "@/components/ui/Badge"
import { Progress } from "@/components/ui/Progress"
import { typeLabel } from "@/lib/compress"
import { formatMegabytes } from "@/lib/limits"
import type { ImageQueueItem } from "./types"

export function ImageItemMeta({ item }: { item: ImageQueueItem }) {
  const progressValue = item.status === "working" ? Math.max(1, Math.round(item.progress)) : item.progress
  return (
    <>
      <div className="meta mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        {item.status === "done" && item.result && !item.result.passthrough ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <span className="text-ok-text" aria-hidden="true">→</span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatMegabytes(item.result.outputBytes)}
            </span>
            {item.storageUploadInProgress ? (
              <Badge variant="shrinking">Saving online · {Math.min(item.uploadProgress ?? 0, 99)}%</Badge>
            ) : (
              <Badge variant="ready">Ready</Badge>
            )}
          </>
        ) : null}
        {item.status === "done" && item.result?.passthrough ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <span>Already fits, unchanged</span>
          </>
        ) : null}
        {item.status === "queued" ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <Badge variant="queued">Queued</Badge>
          </>
        ) : null}
        {item.status === "working" ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <Badge variant="shrinking">Shrinking · {progressValue}%</Badge>
          </>
        ) : null}
        {item.status === "error" ? (
          <>
            <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
            <Badge variant="destructive">Failed</Badge>
          </>
        ) : null}
        {item.status === "done" && item.result ? (
          <Badge variant="outline" className="hidden sm:inline-flex">{typeLabel(item.result.outputType)}</Badge>
        ) : null}
      </div>
      {item.status === "working" ? (
        <>
          <Progress value={progressValue} className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand" aria-label="Shrink progress" />
          <p className="sr-only" role="status">Shrinking {progressValue} percent</p>
        </>
      ) : null}
      {item.status === "done" && item.storageUploadInProgress ? (
        <>
          <Progress
            value={Math.min(item.uploadProgress ?? 0, 99)}
            className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand"
            aria-label="Online save progress"
          />
          <p className="sr-only" role="status">
            Saving online {Math.min(item.uploadProgress ?? 0, 99)} percent
          </p>
        </>
      ) : null}
    </>
  )
}
