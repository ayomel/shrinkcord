"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  cancelVideoJob,
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

type CancelNotice = {
  message: string
  jobId: string
}

const STATUS_LABELS: Record<VideoJob["status"], string> = {
  QUEUED: "Queued",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELED: "Canceled",
}

const TERMINAL_STATUSES = new Set<VideoJob["status"]>(["COMPLETED", "FAILED", "CANCELED"])

function isTerminal(job: VideoJob | null): boolean {
  return Boolean(job && TERMINAL_STATUSES.has(job.status))
}

export function VideoJobStatus({ jobId, onJob }: VideoJobStatusProps) {
  const [job, setJob] = useState<VideoJob | null>(null)
  const [notice, setNotice] = useState<MonitorNotice | null>(null)
  const [retrySequence, setRetrySequence] = useState(0)
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null)
  const [cancelNotice, setCancelNotice] = useState<CancelNotice | null>(null)
  const jobRef = useRef<VideoJob | null>(null)
  const cancelControllerRef = useRef<AbortController | null>(null)
  const cancelSequenceRef = useRef(0)
  const currentJob = job?.id === jobId ? job : null
  const currentNotice = notice?.jobId === jobId && notice.retrySequence === retrySequence ? notice : null
  const currentCancelNotice = cancelNotice?.jobId === jobId ? cancelNotice : null
  const cancelPending = cancelingJobId === jobId
  const canCancel = currentJob?.status === "QUEUED" || currentJob?.status === "PROCESSING"

  const reportCurrentJob = useCallback((nextJob: VideoJob) => {
    const previous = jobRef.current
    if (previous?.id === nextJob.id && isTerminal(previous)) return

    jobRef.current = nextJob
    setJob(nextJob)
    if (isTerminal(nextJob)) {
      setCancelingJobId(null)
      setCancelNotice(null)
    }
    onJob?.(nextJob)
  }, [onJob])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    void monitorVideoJob(jobId, {
      signal: controller.signal,
      onJob: (nextJob) => {
        if (!active || controller.signal.aborted) return
        setNotice(null)
        reportCurrentJob(nextJob)
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
  }, [jobId, retrySequence, reportCurrentJob])

  useEffect(() => () => {
    cancelSequenceRef.current += 1
    cancelControllerRef.current?.abort()
    cancelControllerRef.current = null
    setCancelingJobId(null)
  }, [jobId])

  async function handleCancel() {
    if (!canCancel || cancelControllerRef.current) return

    const requestSequence = ++cancelSequenceRef.current
    const controller = new AbortController()
    cancelControllerRef.current = controller
    setCancelingJobId(jobId)
    setCancelNotice(null)

    try {
      const latest = await cancelVideoJob(jobId, controller.signal)
      if (requestSequence !== cancelSequenceRef.current || controller.signal.aborted) return
      reportCurrentJob(latest)
      if (isTerminal(jobRef.current?.id === jobId ? jobRef.current : null)) {
        setCancelingJobId(null)
      }
    } catch {
      if (requestSequence !== cancelSequenceRef.current || controller.signal.aborted) return
      setCancelingJobId(null)
      setCancelNotice({
        message: "Cancellation could not be confirmed. Try again or keep checking status.",
        jobId,
      })
    } finally {
      if (cancelControllerRef.current === controller) cancelControllerRef.current = null
    }
  }

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
      {canCancel && (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={cancelPending}>
            {cancelPending ? "Canceling compression…" : currentCancelNotice ? "Retry cancellation" : "Cancel compression"}
          </Button>
          {cancelPending && (
            <p className="text-sm text-muted-foreground" role="status">
              Waiting for the job to stop. Its status will continue updating.
            </p>
          )}
          {currentCancelNotice && <p className="text-sm text-destructive" role="alert">{currentCancelNotice.message}</p>}
        </div>
      )}
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
