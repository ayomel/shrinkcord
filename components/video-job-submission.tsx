"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  createVideoJobAttempt,
  submitVideoJob,
  type VideoJobAttempt,
  type VideoJobPhase,
} from "@/lib/video-jobs"

type VideoJobSubmissionProps = {
  file: File
  targetSizeBytes: number | null
  revision: number
  disabled?: boolean
  onLockChange?: (locked: boolean) => void
}

type SubmissionPhase = VideoJobPhase | "ready" | "error"

function phaseLabel(phase: SubmissionPhase) {
  if (phase === "uploading") return "Uploading video"
  if (phase === "submitting") return "Submitting job"
  if (phase === "queued") return "Queued"
  if (phase === "error") return "Submission needs attention"
  return "Ready to submit"
}

export function VideoJobSubmission({ file, targetSizeBytes, revision, disabled = false, onLockChange }: VideoJobSubmissionProps) {
  const attemptRef = useRef<VideoJobAttempt | null>(null)
  const attemptRevisionRef = useRef<number | null>(null)
  const requestSequenceRef = useRef(0)
  const needsRecoveryRef = useRef(false)
  const phaseRef = useRef<SubmissionPhase>("ready")
  const activeRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const [phase, setPhase] = useState<SubmissionPhase>("ready")
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [retryPhase, setRetryPhase] = useState<"uploading" | "submitting">("uploading")
  const [failedRevision, setFailedRevision] = useState<number | null>(null)

  function updatePhase(nextPhase: SubmissionPhase) {
    phaseRef.current = nextPhase
    setPhase(nextPhase)
  }

  useEffect(() => {
    mountedRef.current = true
    if (needsRecoveryRef.current) {
      needsRecoveryRef.current = false
      activeRef.current = false
      if (attemptRef.current?.jobId) {
        setJobId(attemptRef.current.jobId)
        updatePhase("queued")
      } else if (attemptRevisionRef.current !== null) {
        setFailedRevision(attemptRevisionRef.current)
        setRetryPhase(phaseRef.current === "uploading" ? "uploading" : "submitting")
        setError("The request was interrupted. You can retry when you are ready.")
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
  }, [])

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
    const controller = new AbortController()
    controllerRef.current = controller
    const requestSequence = ++requestSequenceRef.current
    setProgress(0)
    setError(null)
    setFailedRevision(null)
    updatePhase("uploading")

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
        setJobId(result.jobId)
        updatePhase("queued")
      }
    } catch (caught) {
      if (mountedRef.current && requestSequence === requestSequenceRef.current
        && !(caught instanceof DOMException && caught.name === "AbortError")) {
        setFailedRevision(revision)
        setRetryPhase(phaseRef.current === "uploading" ? "uploading" : "submitting")
        setError(caught instanceof Error ? caught.message : "Could not submit this video. Try again.")
        updatePhase("error")
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) activeRef.current = false
      if (controllerRef.current === controller) controllerRef.current = null
      if (mountedRef.current && requestSequence === requestSequenceRef.current && controller.signal.aborted) {
        setFailedRevision(revision)
        setRetryPhase(phaseRef.current === "uploading" ? "uploading" : "submitting")
        setError("The request was interrupted. You can retry when you are ready.")
        updatePhase("error")
      }
    }
  }

  const busy = phase === "uploading" || phase === "submitting"
  const showingError = phase === "error" && failedRevision === revision
  const visiblePhase = phase === "error" && !showingError ? "ready" : phase
  useEffect(() => { onLockChange?.(busy || Boolean(jobId)) }, [busy, jobId, onLockChange])
  const submitDisabled = disabled || targetSizeBytes === null || busy || Boolean(jobId)

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <div aria-live="polite" className="text-sm">
        <p className="font-medium">{phaseLabel(visiblePhase)}</p>
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
      <div>
        <Button type="button" onClick={handleSubmit} disabled={submitDisabled}>
          {busy
            ? phase === "uploading" ? "Uploading…" : "Submitting…"
            : showingError
              ? retryPhase === "uploading" ? "Retry upload" : "Retry submission"
              : "Upload and compress"}
        </Button>
      </div>
    </div>
  )
}
