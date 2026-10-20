"use client"

import { useEffect, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DEFAULT_VIDEO_TARGET_BYTES,
  MAX_VIDEO_BYTES,
  parseVideoTarget,
  validateVideoFile,
} from "@/lib/video-selection"



function formatBytes(bytes: number) {
  const megabytes = (bytes / 1_000_000).toLocaleString("en-US", {
    maximumFractionDigits: 6,
  })
  return `${megabytes} MB (${bytes.toLocaleString("en-US")} bytes)`
}

export function VideoSelection() {
  const inputRef = useRef<HTMLInputElement>(null)
  const chooseButtonRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [targetValue, setTargetValue] = useState("20")
  const [error, setError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState(false)
  const target = parseVideoTarget(targetValue)

  useEffect(() => {
    if (!selectedFile || !videoRef.current) return

    const previewUrl = URL.createObjectURL(selectedFile)
    const video = videoRef.current
    video.src = previewUrl
    video.load()

    return () => {
      video.pause()
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(previewUrl)
    }
  }, [selectedFile])

  function acceptFiles(files: FileList | File[]) {
    if (files.length !== 1) {
      setError("Choose one video at a time.")
      return
    }

    const file = files[0]
    const validationError = validateVideoFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setSelectedFile(file)
    setError(null)
    setPreviewError(false)
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files
    if (files?.length) acceptFiles(files)
    event.currentTarget.value = ""
  }

  function removeVideo() {
    setSelectedFile(null)
    setError(null)
    setPreviewError(false)
    if (inputRef.current) inputRef.current.value = ""
    chooseButtonRef.current?.focus()
  }

  return (
    <section
      id="video"
      aria-labelledby="video-heading"
      className="border-t border-border bg-background"
    >
      <div className="mx-auto w-full max-w-[1160px] px-[18px] py-12 sm:px-8 lg:py-[72px]">
        <Card className="mx-auto max-w-3xl">
          <CardHeader>
            <CardTitle className="text-[26px] leading-tight lg:text-[32px]">
              <h2 id="video-heading">Prepare a video</h2>
            </CardTitle>
            <CardDescription>
              Select one MP4 and choose a target size. Your file stays on this device. Video upload
              and compression are coming next.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Video not selected</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div
              className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-5"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                acceptFiles(event.dataTransfer.files)
              }}
            >
              <input
                ref={inputRef}
                id="video-file"
                className="hidden"
                aria-label="Video file"
                tabIndex={-1}
                type="file"
                accept="video/mp4,.mp4"
                onChange={handleInputChange}
              />
              <p className="text-sm text-muted-foreground">
                MP4 only · Up to 524.288 MB (500 MiB) · Drop one video here
              </p>
              <Button
                ref={chooseButtonRef}
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
              >
                {selectedFile ? "Replace video" : "Choose video"}
              </Button>
            </div>

            {selectedFile && (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <video
                    className="max-h-[360px] w-full rounded-lg bg-black"
                    ref={videoRef}
                    aria-label="Original video preview"
                    controls
                    preload="metadata"
                    playsInline
                    onError={() => setPreviewError(true)}
                  />
                  {previewError && (
                    <p className="mt-2 text-sm text-destructive" role="alert">
                      This MP4 could not be previewed in your browser. The file remains selected on
                      this device.
                    </p>
                  )}
                  <p className="mt-3 truncate text-sm font-medium" title={selectedFile.name}>
                    {selectedFile.name}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatBytes(selectedFile.size)}
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={removeVideo}>
                  Remove video
                </Button>
              </div>
            )}

            <div className="max-w-xs">
              <label htmlFor="video-target" className="text-sm font-medium">
                Target size (MB)
              </label>
              <input
                id="video-target"
                type="number"
                inputMode="decimal"
                min="0.000001"
                max={MAX_VIDEO_BYTES / 1_000_000}
                step="any"
                value={targetValue}
                onChange={(event) => setTargetValue(event.currentTarget.value)}
                aria-invalid={Boolean(target.error)}
                aria-describedby={target.error ? "video-target-error" : "video-target-help"}
                className="mt-1.5 h-11 w-full rounded-[10px] border border-input bg-background px-3 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
              />
              {target.error ? (
                <p
                  id="video-target-error"
                  className="mt-1.5 text-sm text-destructive"
                  role="alert"
                  aria-live="polite"
                >
                  {target.error}
                </p>
              ) : (
                <p id="video-target-help" className="mt-1.5 text-sm text-muted-foreground">
                  Target: {formatBytes(target.bytes ?? DEFAULT_VIDEO_TARGET_BYTES)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
