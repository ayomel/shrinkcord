"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  monitorVideoJob,
  VideoJobMonitorError,
  type VideoJob,
} from "@/lib/video-job-monitor"

type VideoJobStatusProps = {
  jobId: string
  onJob?: (job: VideoJob) => void
}

type MonitorNotice = {
  message: string
  recoverable: boolean
  jobId: string
  retrySequence: number
}

const STATUS_LABELS: Record<VideoJob["status"], string> = {
  QUEUED: "Queued",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELED: "Canceled",
}

export function VideoJobStatus({ jobId, onJob }: VideoJobStatusProps) {
  const [job, setJob] = useState<VideoJob | null>(null)
  const [notice, setNotice] = useState<MonitorNotice | null>(null)
  const [retrySequence, setRetrySequence] = useState(0)
  const currentJob = job?.id === jobId ? job : null
  const currentNotice = notice?.jobId === jobId && notice.retrySequence === retrySequence ? notice : null

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    void monitorVideoJob(jobId, {
      signal: controller.signal,
      onJob: (nextJob) => {
        if (!active || controller.signal.aborted) return
        setJob(nextJob)
        setNotice(null)
        onJob?.(nextJob)
      },
      onError: (error) => {
        if (!active || controller.signal.aborted) return
        setNotice({ message: error.message, recoverable: true, jobId, retrySequence })
      },
    }).catch((error: unknown) => {
      if (!active || controller.signal.aborted) return
      const monitorError = error instanceof VideoJobMonitorError
        ? error
        : new VideoJobMonitorError("network_error", "Could not check this video job. Try checking its status again.")
      setNotice({ message: monitorError.message, recoverable: monitorError.recoverable, jobId, retrySequence })
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [jobId, retrySequence, onJob])

  const progress = currentJob
    ? currentJob.status === "COMPLETED" ? 100 : Math.min(currentJob.progress, 99)
    : null
  const failureMessage = currentJob?.status === "FAILED"
    ? currentJob.error_message?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240)
      || "Compression failed. Try again later."
    : null

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">
        {currentJob ? STATUS_LABELS[currentJob.status] : "Checking job status…"}
      </p>
      {currentJob && progress !== null && (
        <div className="max-w-md">
          <progress
            className="h-2 w-full accent-primary"
            max={100}
            value={progress}
            aria-label="Compression progress"
          />
          <p className="mt-1 text-muted-foreground">{progress}% complete</p>
        </div>
      )}
      {failureMessage && <p className="text-destructive" role="alert">{failureMessage}</p>}
      {currentNotice && (
        <div className="flex flex-col items-start gap-2">
          <p
            className={currentNotice.recoverable ? "text-muted-foreground" : "text-destructive"}
            role={currentNotice.recoverable ? "status" : "alert"}
          >
            {currentNotice.message}
          </p>
          {!currentNotice.recoverable && (
            <Button type="button" variant="outline" onClick={() => setRetrySequence((sequence) => sequence + 1)}>
              Retry status
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
