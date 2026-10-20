"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  fetchVideoJobOutput,
  getVideoOutputFileName,
  VideoOutputError,
  type VideoJobOutput,
} from "@/lib/video-job-output"

type VideoJobResultProps = {
  jobId: string
  inputFile: File
  targetSizeBytes: number | null
  outputExpired: boolean
  outputExpiresAt?: string | null
  onVisibleChange: (visible: boolean) => void
  onStartAnotherAttempt: () => void
}

function formatBytes(bytes: number) {
  const megabytes = (bytes / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })
  return `${megabytes} MB (${bytes.toLocaleString("en-US")} bytes)`
}

function formatExpiration(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? `Available until ${date.toLocaleString()}`
    : null
}

export function VideoJobResult({
  jobId,
  inputFile,
  targetSizeBytes,
  outputExpired,
  outputExpiresAt,
  onVisibleChange,
  onStartAnotherAttempt,
}: VideoJobResultProps) {
  const [output, setOutput] = useState<VideoJobOutput | null>(null)
  const [error, setError] = useState<VideoOutputError | null>(null)
  const [loading, setLoading] = useState(!outputExpired)
  const [retrySequence, setRetrySequence] = useState(0)
  const inputVideoRef = useRef<HTMLVideoElement>(null)
  const outputVideoRef = useRef<HTMLVideoElement>(null)
  const downloadLinkRef = useRef<HTMLAnchorElement>(null)
  const visibleOutput = outputExpired ? null : output
  const outputExpiredNow = outputExpired || error?.expired === true
  const visibleErrorMessage = outputExpired
    ? "This output has expired. Start another attempt with this video to create a new compressed result."
    : error?.message

  useEffect(() => {
    onVisibleChange(true)
    return () => onVisibleChange(false)
  }, [onVisibleChange])

  useEffect(() => {
    const url = URL.createObjectURL(inputFile)
    const video = inputVideoRef.current
    if (video) {
      video.src = url
      video.load()
    }
    return () => {
      if (video) {
        video.pause()
        video.removeAttribute("src")
        video.load()
      }
      URL.revokeObjectURL(url)
    }
  }, [inputFile])

  useEffect(() => {
    const video = outputVideoRef.current
    const downloadLink = downloadLinkRef.current
    if (!visibleOutput || !video) return
    const url = URL.createObjectURL(visibleOutput.blob)
    video.src = url
    video.load()
    if (downloadLink) downloadLink.href = url
    return () => {
      video.pause()
      video.removeAttribute("src")
      video.load()
      downloadLink?.removeAttribute("href")
      URL.revokeObjectURL(url)
    }
  }, [visibleOutput])

  useEffect(() => {
    if (outputExpired) return

    const controller = new AbortController()
    let active = true

    void fetchVideoJobOutput(jobId, { signal: controller.signal })
      .then((result) => {
        if (active) setOutput(result)
      })
      .catch((caught: unknown) => {
        if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return
        setError(caught instanceof VideoOutputError
          ? caught
          : new VideoOutputError("Could not download this video's output. Try again.", { retryable: true }))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [jobId, outputExpired, retrySequence])

  const difference = visibleOutput ? inputFile.size - visibleOutput.bytes : 0
  const savingsPercent = visibleOutput && inputFile.size > 0
    ? Math.abs(difference) / inputFile.size * 100
    : 0
  const expiration = formatExpiration(outputExpiresAt)

  return (
    <section className="mt-5 border-t border-border pt-5" aria-labelledby="video-result-heading">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="video-result-heading" className="text-lg font-semibold">Your compressed video</h3>
          <p className="text-sm text-muted-foreground">
            Compare both versions, then download the compressed MP4.
          </p>
        </div>
        {expiration && <p className="text-xs text-muted-foreground">{expiration}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="min-w-0 rounded-lg border border-border bg-background p-4">
          <h4 className="mb-3 text-sm font-semibold">Original</h4>
          <video
            ref={inputVideoRef}
            className="max-h-[360px] w-full rounded-md bg-black"
            aria-label="Original video preview"
            controls
            preload="metadata"
            playsInline
          />
          <p className="mt-3 truncate text-sm font-medium" title={inputFile.name}>{inputFile.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{formatBytes(inputFile.size)}</p>
        </article>

        <article className="min-w-0 rounded-lg border border-border bg-background p-4">
          <h4 className="mb-3 text-sm font-semibold">Compressed</h4>
          {visibleOutput ? (
            <video
              ref={outputVideoRef}
              className="max-h-[360px] w-full rounded-md bg-black"
              aria-label="Compressed video preview"
              controls
              preload="metadata"
              playsInline
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-md bg-muted px-4 text-center text-sm text-muted-foreground">
              {loading && !outputExpiredNow ? "Preparing compressed preview…" : outputExpiredNow ? "This output has expired." : "Preview unavailable."}
            </div>
          )}
          <p className="mt-3 truncate text-sm font-medium" title={getVideoOutputFileName(inputFile.name)}>
            {getVideoOutputFileName(inputFile.name)}
          </p>
          {visibleOutput && (
            <>
              <p className="mt-1 text-sm text-muted-foreground">{formatBytes(visibleOutput.bytes)}</p>
              <p className="mt-2 text-sm font-medium">
                {difference >= 0 ? "Saved" : "Larger by"} {formatBytes(Math.abs(difference))}
                {inputFile.size > 0 && ` (${savingsPercent.toLocaleString("en-US", { maximumFractionDigits: 1 })}%)`}
              </p>
              {targetSizeBytes !== null && visibleOutput.bytes >= targetSizeBytes && (
                <p className="mt-2 text-sm text-muted-foreground" role="status">
                  Output is at or above your {formatBytes(targetSizeBytes)} target ({formatBytes(visibleOutput.bytes)}).
                </p>
              )}
            </>
          )}
        </article>
      </div>

      {loading && !outputExpiredNow && (
        <p className="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
          Downloading the compressed video for preview… Large files may take a few minutes.
        </p>
      )}
      {visibleErrorMessage && (
        <div className="mt-4 flex flex-col items-start gap-3" role={outputExpiredNow ? "alert" : "status"}>
          <p className={outputExpiredNow ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {visibleErrorMessage}
          </p>
          {outputExpiredNow ? (
            <Button type="button" variant="outline" onClick={onStartAnotherAttempt}>Start another attempt</Button>
          ) : error?.retryable ? (
            <Button type="button" variant="outline" onClick={() => {
              setOutput(null)
              setError(null)
              setLoading(true)
              setRetrySequence((sequence) => sequence + 1)
            }}>
              Retry download
            </Button>
          ) : null}
        </div>
      )}
      {visibleOutput && (
        <div className="mt-4 flex flex-col items-start gap-2">
          <Button asChild>
            <a ref={downloadLinkRef} download={getVideoOutputFileName(inputFile.name)}>
              Download {getVideoOutputFileName(inputFile.name)}
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">Download size: {formatBytes(visibleOutput.bytes)}</p>
        </div>
      )}
    </section>
  )
}
