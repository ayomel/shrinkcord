"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { VideoJobResult } from "@/components/video-job-result"
import { VideoJobStatus } from "@/components/video-job-status"
import {
  createVideoJobAttempt,
  submitVideoJob,
  type VideoJobAttempt,
  type VideoJobPhase,
} from "@/lib/video-jobs"
import type { VideoJob } from "@/lib/video-job-monitor"

type VideoJobSubmissionProps = {
  file: File
  targetSizeBytes: number | null
  revision: number
  disabled?: boolean
  onLockChange?: (locked: boolean) => void
  onResultVisible: (visible: boolean) => void
  onStartAnotherAttempt: () => void
}

type SubmissionPhase = VideoJobPhase | "ready" | "error"

function phaseLabel(phase: SubmissionPhase) {
  if (phase === "uploading") return "Uploading video"
  if (phase === "submitting") return "Submitting job"
  if (phase === "queued") return "Queued"
  if (phase === "error") return "Submission needs attention"
  return "Ready to submit"
}

export function VideoJobSubmission({
  file,
  targetSizeBytes,
  revision,
  disabled = false,
  onLockChange,
  onResultVisible,
  onStartAnotherAttempt,
}: VideoJobSubmissionProps) {
  const attemptRef = useRef<VideoJobAttempt | null>(null)
  const attemptRevisionRef = useRef<number | null>(null)
  const requestSequenceRef = useRef(0)
  const needsRecoveryRef = useRef(false)
  const phaseRef = useRef<SubmissionPhase>("ready")
  const activeRef = useRef(false)
  const locallyCancelingUploadRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const [phase, setPhase] = useState<SubmissionPhase>("ready")
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const [uploadCanceling, setUploadCanceling] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<VideoJob["status"] | null>(null)
  const [completedJob, setCompletedJob] = useState<VideoJob | null>(null)
  const [retryPhase, setRetryPhase] = useState<"uploading" | "submitting">("uploading")
  const [failedRevision, setFailedRevision] = useState<number | null>(null)
  const handleJobUpdate = useCallback((job: VideoJob) => {
    setJobStatus(job.status)
    if (job.status === "COMPLETED") setCompletedJob(job)
    if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELED") {
      setSubmissionUncertain(false)
      onLockChange?.(false)
    }
  }, [onLockChange])

  function updatePhase(nextPhase: SubmissionPhase) {
    phaseRef.current = nextPhase
    setPhase(nextPhase)
  }

  useEffect(() => {
    mountedRef.current = true
    if (needsRecoveryRef.current) {
      needsRecoveryRef.current = false
      activeRef.current = false
      setUploadCanceling(false)
      if (attemptRef.current?.jobId) {
        setJobId(attemptRef.current.jobId)
        updatePhase("queued")
      } else if (attemptRevisionRef.current !== null) {
        setFailedRevision(attemptRevisionRef.current)
        setRetryPhase(phaseRef.current === "uploading" ? "uploading" : "submitting")
        const uncertain = phaseRef.current === "submitting"
        setSubmissionUncertain(uncertain)
        if (uncertain) onLockChange?.(true)
        setError(uncertain
          ? "The job response was interrupted. Retry submission to recover the job using the same request key; your video and target are locked until then."
          : "The request was interrupted. You can retry when you are ready.")
        updatePhase("error")
      } else {
        updatePhase("ready")
      }
    }

    return () => {
      mountedRef.current = false
      if (controllerRef.current) {
        needsRecoveryRef.current = true
        controllerRef.current.abort()
        controllerRef.current = null
        activeRef.current = false
        requestSequenceRef.current += 1
      }
    }
  }, [onLockChange])

  async function handleSubmit() {
    if (activeRef.current || disabled || targetSizeBytes === null || jobId) return

    const existingAttempt = attemptRef.current
    const attempt = existingAttempt?.file === file
      && existingAttempt.targetSizeBytes === targetSizeBytes
      && attemptRevisionRef.current === revision
      ? existingAttempt
      : createVideoJobAttempt(file, targetSizeBytes)
    attemptRef.current = attempt
    attemptRevisionRef.current = revision

    activeRef.current = true
    onLockChange?.(true)
    locallyCancelingUploadRef.current = false
    const controller = new AbortController()
    controllerRef.current = controller
    const requestSequence = ++requestSequenceRef.current
    setProgress(0)
    setError(null)
    setFailedRevision(null)
    setUploadCanceling(false)
    updatePhase(attempt.inputKey ? "submitting" : "uploading")

    try {
      const result = await submitVideoJob({
        file,
        targetSizeBytes,
        attempt,
        signal: controller.signal,
        onPhase: (nextPhase) => {
          if (requestSequence !== requestSequenceRef.current) return
          phaseRef.current = nextPhase
          if (mountedRef.current) setPhase(nextPhase)
        },
        onProgress: (percent) => {
          if (mountedRef.current && requestSequence === requestSequenceRef.current) setProgress(percent)
        },
      })
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setSubmissionUncertain(false)
        setJobId(result.jobId)
        setJobStatus("QUEUED")
        updatePhase("queued")
      }
    } catch (caught) {
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        const wasAborted = caught instanceof DOMException && caught.name === "AbortError"
        const uploadCanceled = wasAborted && locallyCancelingUploadRef.current
        const uncertain = phaseRef.current === "submitting" && !uploadCanceled
        if (uploadCanceled) {
          locallyCancelingUploadRef.current = false
          setUploadCanceling(false)
        }
        if (uncertain) setSubmissionUncertain(true)
        setFailedRevision(revision)
        setRetryPhase(uploadCanceled || phaseRef.current === "uploading" ? "uploading" : "submitting")
        setError(uploadCanceled
          ? "Upload canceled. Retry the upload when you are ready."
          : uncertain
            ? "The job response could not be confirmed. Retry submission to recover the job using the same request key; your video and target are locked until then."
            : wasAborted
              ? "The request was interrupted. You can retry when you are ready."
              : caught instanceof Error ? caught.message : "Could not submit this video. Try again.")
        updatePhase("error")
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) activeRef.current = false
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }

  function handleCancelUpload() {
    if (phaseRef.current !== "uploading" || !controllerRef.current) return
    locallyCancelingUploadRef.current = true
    setUploadCanceling(true)
    controllerRef.current.abort()
  }

  const busy = phase === "uploading" || phase === "submitting"
  const showingError = phase === "error" && failedRevision === revision
  const visiblePhase = phase === "error" && !showingError ? "ready" : phase
  const jobIsTerminal = jobStatus === "COMPLETED" || jobStatus === "FAILED" || jobStatus === "CANCELED"
  useEffect(() => {
    onLockChange?.(busy || (Boolean(jobId) && !jobIsTerminal) || submissionUncertain)
  }, [busy, jobId, jobIsTerminal, submissionUncertain, onLockChange])
  const submitDisabled = disabled || targetSizeBytes === null || busy || Boolean(jobId)

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <div aria-live="polite" className="text-sm">
        {jobId
          ? <VideoJobStatus jobId={jobId} onJob={handleJobUpdate} />
          : <p className="font-medium">{phaseLabel(visiblePhase)}</p>}
        {phase === "uploading" && (
          <div className="mt-2 max-w-md">
            <label htmlFor="video-upload-progress" className="sr-only">Video upload progress</label>
            <progress
              id="video-upload-progress"
              className="h-2 w-full accent-primary"
              max={100}
              value={progress}
            />
            <p className="mt-1 text-muted-foreground">{progress}% uploaded</p>
          </div>
        )}
        {phase === "submitting" && <p className="mt-1 text-muted-foreground">Creating your compression job…</p>}
        {showingError && error && <p className="mt-2 text-destructive" role="alert">{error}</p>}
        {jobId && <p className="mt-1 text-muted-foreground">Job ID: <code>{jobId}</code></p>}
      </div>
      {jobId && completedJob?.id === jobId && <VideoJobResult
        jobId={jobId}
        inputFile={file}
        targetSizeBytes={targetSizeBytes}
        outputExpired={completedJob.output_expired === true}
        outputExpiresAt={completedJob.output_expires_at}
        onVisibleChange={onResultVisible}
        onStartAnotherAttempt={onStartAnotherAttempt}
      />}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handleSubmit} disabled={submitDisabled}>
            {busy
              ? phase === "uploading" ? "Uploading…" : "Submitting…"
              : showingError
                ? retryPhase === "uploading" ? "Retry upload" : "Retry submission"
                : "Upload and compress"}
          </Button>
          {busy && phase === "uploading" && (
            <Button type="button" variant="outline" onClick={handleCancelUpload} disabled={uploadCanceling}>
              {uploadCanceling ? "Canceling upload…" : "Cancel upload"}
            </Button>
          )}
          {jobId && jobIsTerminal && (
            <Button type="button" variant="outline" onClick={onStartAnotherAttempt}>
              Start another attempt
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
