import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createVideoJobAttempt,
  submitVideoJob,
  type VideoJobTransport,
} from "./video-jobs.ts"

const jobId = "123e4567-e89b-42d3-a456-426614174000"

function fixture(transportOverrides: Partial<VideoJobTransport> = {}) {
  const file = new File(["video bytes"], "clip.mp4", { type: "video/mp4" })
  const transport: VideoJobTransport = {
    uploadJob: async ({ onUploadProgress }) => {
      onUploadProgress?.(1, 2)
      return { id: jobId }
    },
    ...transportOverrides,
  }
  return { file, transport }
}

describe("submitVideoJob", () => {
  it("uploads via multipart POST and reports upload progress capped below 100", async () => {
    const { file, transport } = fixture()
    const attempt = createVideoJobAttempt(file, 20_000_000)
    const progress: number[] = []

    const result = await submitVideoJob({
      file,
      targetSizeBytes: 20_000_000,
      attempt,
      transport,
      onProgress: (percent) => progress.push(percent),
    })

    assert.deepEqual(progress, [50])
    assert.equal(attempt.jobId, jobId)
    assert.equal(result.jobId, jobId)
  })

  it("rejects simultaneous submissions for one attempt", async () => {
    const { file, transport } = fixture()
    let release!: () => void
    transport.uploadJob = () => new Promise((resolve) => {
      release = () => resolve({ id: jobId })
    })
    const attempt = createVideoJobAttempt(file, 20_000_000)
    const first = submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt, transport })
    await assert.rejects(
      submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt, transport }),
      /already being submitted/i,
    )
    release()
    await first
  })

  it("does not upload again after the attempt has succeeded", async () => {
    const { file, transport } = fixture()
    let calls = 0
    transport.uploadJob = async () => {
      calls += 1
      return { id: jobId }
    }
    const attempt = createVideoJobAttempt(file, 20_000_000)
    await submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt, transport })
    await submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt, transport })
    assert.equal(calls, 1)
  })
})
