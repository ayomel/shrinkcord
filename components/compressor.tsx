"use client"

import FileInput from "@/components/block/file-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { OrbitalLoadingRing } from "@/components/ui/orbital-loading-ring"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { type ShrinkResult, typeLabel } from "@/lib/compress"
import { acceptedType, formatMegabytes } from "@/lib/limits"
import { runShrink } from "@/lib/run-shrink"
import { useEffect, useRef, useState } from "react"

type ItemStatus = "queued" | "working" | "done" | "error"

type QueueItem = {
  id: string
  file: File
  status: ItemStatus
  progress: number
  error?: string
  result?: ShrinkResult
  downloadUrl?: string
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
    void drain()
  }

  return (
    <Card id="shrink" className="scroll-mt-24">
      <CardContent className="flex flex-col gap-5">
        <FileInput allowMultiple onFileChange={enqueue} />
        {items.length > 0 ? (
          <ul aria-live="polite" className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-background px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{item.file.name}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {formatMegabytes(item.file.size)}
                      {item.result && !item.result.passthrough
                        ? ` → ${formatMegabytes(item.result.outputBytes)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{typeLabel(acceptedType(item.file) ?? item.file.type)}</Badge>
                    {item.status === "queued" ? <Badge variant="secondary">Queued</Badge> : null}
                    {item.status === "working" ? (
                      <Badge>
                        <Spinner className="size-3" />
                        Shrinking
                      </Badge>
                    ) : null}
                    {item.status === "done" && item.result?.passthrough ? (
                      <Badge variant="secondary">Already fits</Badge>
                    ) : null}
                    {item.status === "done" && item.result && !item.result.passthrough ? (
                      <Badge>Ready</Badge>
                    ) : null}
                    {item.status === "error" ? <Badge variant="destructive">Failed</Badge> : null}
                    {item.status === "working" ? (
                      <OrbitalLoadingRing size={36} variant="minimal" label="Shrinking image" />
                    ) : null}
                    {item.status === "done" && item.downloadUrl && item.result ? (
                      <Button
                        type="button"
                        onClick={() => {
                          const anchor = document.createElement("a")
                          anchor.href = item.downloadUrl!
                          anchor.download = item.result!.fileName
                          anchor.click()
                        }}
                      >
                        Download
                      </Button>
                    ) : null}
                  </div>
                </div>
                {item.status === "working" ? (
                  <Progress value={item.progress} className="mt-3" aria-label="Shrink progress" />
                ) : null}
                {item.status === "error" ? (
                  <Alert variant="destructive" className="mt-3">
                    <AlertTitle>Could not shrink</AlertTitle>
                    <AlertDescription>{item.error}</AlertDescription>
                  </Alert>
                ) : null}
                {item.result?.convertedFromPng ? (
                  <Alert className="mt-3">
                    <AlertTitle>PNG saved as JPEG</AlertTitle>
                    <AlertDescription>
                      Transparency was flattened onto white so the file could get under 19.5 MB.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {item.result?.scaled && !item.result.missedTarget ? (
                  <p className="mt-3 font-mono text-xs text-muted-foreground">
                    Scaled to {item.result.width}×{item.result.height} after quality alone was still too big.
                  </p>
                ) : null}
                {item.result?.missedTarget ? (
                  <Alert variant="destructive" className="mt-3">
                    <AlertTitle>Still over 19.5 MB</AlertTitle>
                    <AlertDescription>
                      This is the smallest file the browser could make, at {formatMegabytes(item.result.outputBytes)}.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {item.result?.passthrough ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Already under 20 MB. The original file is ready to download.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
