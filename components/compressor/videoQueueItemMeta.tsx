import { Badge } from "@/components/ui/Badge"
import { Progress } from "@/components/ui/Progress"
import { formatMegabytes } from "@/lib/limits"
import { videoProgressSnapshot } from "@/lib/video-progress"
import type { VideoQueueItem } from "./types"

export function VideoItemMeta({ item }: { item: VideoQueueItem }) {
  const uploadValue = Math.min(item.uploadProgress, 99)
  const compressValue = Math.min(item.compressProgress, 99)
  const downloadValue = Math.min(item.downloadProgress, 99)

  const snapshot =
    item.status === "uploading"
      ? videoProgressSnapshot({ phase: "uploading", uploadPercent: uploadValue, compressPercent: 0 })
      : item.status === "processing"
        ? videoProgressSnapshot({
            phase: "compressing",
            uploadPercent: 100,
            compressPercent: compressValue,
          })
        : item.status === "done"
          ? videoProgressSnapshot({
              phase: "completed",
              uploadPercent: 100,
              compressPercent: 100,
              completed: true,
            })
          : null

  const srProgress =
    item.status === "uploading"
      ? `Uploading ${uploadValue} percent`
      : item.status === "downloading"
        ? `Downloading ${downloadValue} percent`
        : item.status === "processing"
          ? `Compressing ${compressValue} percent`
          : snapshot
            ? snapshot.phase === "completed"
              ? "Video ready"
              : undefined
            : undefined

  return (
    <>
      <div className="meta mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="font-mono text-xs tabular-nums">{formatMegabytes(item.file.size)}</span>
        {item.status === "done" && item.outputBytes !== undefined ? (
          <>
            <span className="text-ok-text" aria-hidden="true">→</span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatMegabytes(item.outputBytes)}
            </span>
            <Badge variant="ready">Ready</Badge>
          </>
        ) : null}
        {item.status === "precheck" ? <Badge variant="queued">Checking…</Badge> : null}
        {item.status === "queued" ? <Badge variant="queued">Queued</Badge> : null}
        {item.status === "server_busy" ? <Badge variant="shrinking">Server busy, retrying</Badge> : null}
        {item.status === "uploading" ? <Badge variant="shrinking">Uploading · {uploadValue}%</Badge> : null}
        {item.status === "job_queued" ? <Badge variant="queued">Queued on server</Badge> : null}
        {item.status === "processing" ? (
          <Badge variant="shrinking">Compressing · {compressValue}%</Badge>
        ) : null}
        {item.status === "downloading" ? <Badge variant="shrinking">Downloading · {downloadValue}%</Badge> : null}
        {item.status === "error" ? <Badge variant="destructive">Failed</Badge> : null}
        {item.status === "canceled" ? <Badge variant="outline">Canceled</Badge> : null}
      </div>
      {item.status === "uploading" ? (
        <>
          <Progress value={uploadValue} className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand" aria-label="Video upload progress" />
          <p className="sr-only" role="status">{srProgress}</p>
        </>
      ) : null}
      {item.status === "processing" ? (
        <>
          <Progress value={compressValue} className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand" aria-label="Video compression progress" />
          <p className="sr-only" role="status">{srProgress}</p>
        </>
      ) : null}
      {item.status === "downloading" ? (
        <>
          <Progress value={downloadValue} className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand" aria-label="Video download progress" />
          <p className="sr-only" role="status">{srProgress}</p>
        </>
      ) : null}
      {item.status === "server_busy" ? (
        <p className="sr-only" role="status">Server busy, retrying</p>
      ) : null}
    </>
  )
}
