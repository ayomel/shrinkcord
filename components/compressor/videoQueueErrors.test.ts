import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { VideoJobMonitorError } from "@/lib/video/videoJobMonitor"
import { VideoOutputError } from "@/lib/video/videoJobOutput"
import { mapVideoQueueError } from "./videoQueueErrors"

describe("video queue error retryability", () => {
  it("offers retry for recoverable job-monitor errors", () => {
    const error = new VideoJobMonitorError("network_error", "Status request failed.", { recoverable: true })
    assert.deepEqual(mapVideoQueueError(error), { message: "Status request failed.", canRetry: true })
  })

  it("offers retry for transient output errors", () => {
    const error = new VideoOutputError("Download failed.", { status: 503, retryable: true })
    assert.deepEqual(mapVideoQueueError(error), { message: "Download failed.", canRetry: true })
  })

  it("does not offer retry for expired output or permanent monitor errors", () => {
    const expired = new VideoOutputError("Output expired.", { status: 403, expired: true, retryable: false })
    const invalid = new VideoJobMonitorError("invalid_job_id", "Invalid job ID.")
    assert.equal(mapVideoQueueError(expired).canRetry, false)
    assert.equal(mapVideoQueueError(invalid).canRetry, false)
  })
})
