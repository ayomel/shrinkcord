"use client"

import FileInput from "@/components/block/file-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { type ShrinkResult, typeLabel } from "@/lib/compress"
import { acceptedType, formatMegabytes } from "@/lib/limits"
import { runShrink } from "@/lib/run-shrink"
import { zipSync } from "fflate"
import { AlertCircle, X } from "lucide-react"
import { useEffect, useRef, useState, type MutableRefObject } from "react"

type ItemStatus = "queued" | "working" | "done" | "error"

type QueueItem = {
  id: string
  file: File
  status: ItemStatus
  progress: number
  error?: string
  result?: ShrinkResult
  downloadUrl?: string
  thumbUrl?: string
}

function ResultThumb({ url, name }: { url?: string; name: string }) {
  if (!url) {
    return (
      <div
        className="size-11 shrink-0 rounded-lg bg-[linear-gradient(135deg,#7a5cff,#2bb3a3_60%,#f2b84b)]"
        aria-hidden="true"
      />
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- object URL preview, not a remote asset
    <img
      src={url}
      alt=""
      className="size-11 shrink-0 rounded-lg object-cover"
      title={name}
    />
  )
}

async function makeThumbUrl(file: File): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: 88,
      resizeHeight: 88,
      resizeQuality: "low",
    })
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (!context) {
      bitmap.close()
      return undefined
    }
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.72)
    })
    if (!blob) return undefined
    return URL.createObjectURL(blob)
  } catch {
    return undefined
  }
}

function revokeTracked(urls: MutableRefObject<string[]>, url?: string) {
  if (!url) return
  URL.revokeObjectURL(url)
  urls.current = urls.current.filter((entry) => entry !== url)
}

export function Compressor() {
  const [items, setItems] = useState<QueueItem[]>([])
  const itemsRef = useRef<QueueItem[]>([])
  const running = useRef(false)
  const urls = useRef<string[]>([])

  useEffect(() => {
    const created = urls.current
    return () => {
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [])

  const update = (id: string, patch: Partial<QueueItem>) => {
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    )
    setItems(itemsRef.current)
  }

  const drain = async () => {
    if (running.current) return
    running.current = true

    try {
      while (itemsRef.current.some((item) => item.status === "queued")) {
        const current = itemsRef.current.find((item) => item.status === "queued")
        if (!current) break
        update(current.id, { status: "working", progress: 4 })

        if (!acceptedType(current.file)) {
          update(current.id, {
            status: "error",
            progress: 0,
            error: "Use a JPEG, PNG, or WebP.",
          })
          continue
        }

        try {
          const result = await runShrink(current.file, (progress) => {
            update(current.id, { progress })
          })
          const downloadUrl = URL.createObjectURL(result.blob)
          urls.current.push(downloadUrl)
          update(current.id, { status: "done", progress: 100, result, downloadUrl })
        } catch (error) {
          update(current.id, {
            status: "error",
            progress: 0,
            error: error instanceof Error ? error.message : "Could not shrink this image.",
          })
        }
      }
    } finally {
      running.current = false
    }
  }

  const enqueue = (files: File[]) => {
    const next = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued" as const,
      progress: 0,
    }))
    itemsRef.current = [...itemsRef.current, ...next]
    setItems(itemsRef.current)

    for (const item of next) {
      void makeThumbUrl(item.file).then((thumbUrl) => {
        if (!thumbUrl) return
        const stillPresent = itemsRef.current.some((entry) => entry.id === item.id)
        if (!stillPresent) {
          URL.revokeObjectURL(thumbUrl)
          return
        }
        urls.current.push(thumbUrl)
        update(item.id, { thumbUrl })
      })
    }

    void drain()
  }

  const removeItem = (id: string) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (!target) return
    revokeTracked(urls, target.thumbUrl)
    revokeTracked(urls, target.downloadUrl)
    itemsRef.current = itemsRef.current.filter((item) => item.id !== id)
    setItems(itemsRef.current)
  }

  const clearAll = () => {
    for (const item of itemsRef.current) {
      revokeTracked(urls, item.thumbUrl)
      revokeTracked(urls, item.downloadUrl)
    }
    itemsRef.current = []
    setItems([])
  }

  const downloadOne = (item: QueueItem) => {
    if (!item.downloadUrl || !item.result) return
    const anchor = document.createElement("a")
    anchor.href = item.downloadUrl
    anchor.download = item.result.fileName
    anchor.click()
  }

  const downloadable = items.filter(
    (item) => item.status === "done" && item.result && item.downloadUrl,
  )

  const downloadAll = async () => {
    if (downloadable.length === 0) return

    const entries: Record<string, Uint8Array> = {}
    const usedNames = new Set<string>()

    for (const item of downloadable) {
      const buffer = new Uint8Array(await item.result!.blob.arrayBuffer())
      let name = item.result!.fileName
      if (usedNames.has(name)) {
        const stem = name.replace(/(\.[^.]+)?$/, "")
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
        let n = 2
        while (usedNames.has(`${stem}-${n}${ext}`)) n += 1
        name = `${stem}-${n}${ext}`
      }
      usedNames.add(name)
      entries[name] = buffer
    }

    const zipped = zipSync(entries, { level: 0 })
    const blob = new Blob([zipped], { type: "application/zip" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "shrinkcord-discord.zip"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      id="shrink"
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-3 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] sm:p-4"
    >
      <FileInput allowMultiple onFileChange={enqueue} />
      {items.length > 0 ? (
        <ul aria-live="polite" className="mt-3 grid gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[10px] border border-border bg-surface-2 p-2.5 sm:px-3"
            >
              <ResultThumb url={item.thumbUrl} name={item.file.name} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {item.file.name}
                </p>
                <div className="meta mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
                  {item.status === "done" && item.result && !item.result.passthrough ? (
                    <>
                      <span className="font-mono text-xs tabular-nums">
                        {formatMegabytes(item.file.size)}
                      </span>
                      <span className="text-ok-text" aria-hidden="true">
                        →
                      </span>
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {formatMegabytes(item.result.outputBytes)}
                      </span>
                      <Badge variant="ready">Ready</Badge>
                    </>
                  ) : null}
                  {item.status === "done" && item.result?.passthrough ? (
                    <>
                      <span className="font-mono text-xs tabular-nums">
                        {formatMegabytes(item.file.size)}
                      </span>
                      <span>Already fits — unchanged</span>
                    </>
                  ) : null}
                  {item.status === "queued" ? (
                    <>
                      <span className="font-mono text-xs tabular-nums">
                        {formatMegabytes(item.file.size)}
                      </span>
                      <Badge variant="queued">Queued</Badge>
                    </>
                  ) : null}
                  {item.status === "working" ? (
                    <>
                      <span className="font-mono text-xs tabular-nums">
                        {formatMegabytes(item.file.size)}
                      </span>
                      <Badge variant="shrinking">
                        Shrinking · {Math.max(1, Math.round(item.progress))}%
                      </Badge>
                    </>
                  ) : null}
                  {item.status === "error" ? (
                    <>
                      <span className="font-mono text-xs tabular-nums">
                        {formatMegabytes(item.file.size)}
                      </span>
                      <Badge variant="destructive">Failed</Badge>
                    </>
                  ) : null}
                  {item.status === "done" && item.result ? (
                    <Badge variant="outline" className="hidden sm:inline-flex">
                      {typeLabel(item.result.outputType)}
                    </Badge>
                  ) : null}
                </div>
                {item.status === "working" ? (
                  <Progress
                    value={item.progress}
                    className="mt-1.5 h-1 rounded bg-[#33363d] [&>[data-slot=progress-indicator]]:bg-brand"
                    aria-label="Shrink progress"
                  />
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-center">
                {item.status === "done" && item.downloadUrl && item.result ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={item.result.passthrough ? "outline" : "default"}
                    className="hidden sm:inline-flex"
                    onClick={() => downloadOne(item)}
                  >
                    Download
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removeItem(item.id)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              {item.status === "done" && item.downloadUrl && item.result ? (
                <Button
                  type="button"
                  size="sm"
                  variant={item.result.passthrough ? "outline" : "default"}
                  className="col-span-3 w-full sm:hidden"
                  onClick={() => downloadOne(item)}
                >
                  Download
                </Button>
              ) : null}
              {item.status === "error" ? (
                <div className="col-span-3 flex items-start gap-2 border-t border-border pt-2 text-[12.5px] text-destructive sm:col-start-2 sm:col-span-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{item.error}</span>
                </div>
              ) : null}
              {item.result?.flattenedTransparency ? (
                <div className="col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2">
                  <span className="font-semibold text-warn">Saved as JPEG.</span> Transparency was
                  flattened onto white so the file could get under 19.5 MB.
                </div>
              ) : item.result?.convertedFromPng ? (
                <div className="col-span-3 border-t border-border pt-2 text-[12.5px] text-muted-foreground sm:col-start-2 sm:col-span-2">
                  <span className="font-semibold text-warn">Saved as JPEG.</span> PNG can&apos;t be
                  shrunk with a quality setting, so it was converted.
                </div>
              ) : null}
              {item.result?.scaled && !item.result.missedTarget ? (
                <p className="col-span-3 border-t border-border pt-2 font-mono text-xs text-muted-foreground sm:col-start-2 sm:col-span-2">
                  Scaled to {item.result.width}×{item.result.height} after quality alone was still
                  too big.
                </p>
              ) : null}
              {item.result?.missedTarget ? (
                <div className="col-span-3 flex items-start gap-2 border-t border-border pt-2 text-[12.5px] text-destructive sm:col-start-2 sm:col-span-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Still over 19.5 MB — smallest the browser could make is{" "}
                    {formatMegabytes(item.result.outputBytes)}.
                  </span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <div className="mt-3 flex flex-col items-start justify-between gap-2 px-1 pt-1 text-[13px] text-muted-foreground sm:flex-row sm:items-center">
          <span>
            Files are saved with <code>-discord</code> in the name.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={clearAll}>
              Clear all
            </Button>
            {downloadable.length > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void downloadAll()}>
                Download all ({downloadable.length})
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
