import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createVideoJobAttempt,
  submitVideoJob,
  type VideoJobTransport,
} from "./video-jobs.ts"

const uploadUrl = "https://storage.example.test/upload?signature=temporary"
const jobId = "123e4567-e89b-42d3-a456-426614174000"

function fixture(transportOverrides: Partial<VideoJobTransport> = {}) {
  const file = new File(["video bytes"], "clip.mp4", { type: "video/mp4" })
  const calls: string[] = []
  const transport: VideoJobTransport = {
    createUpload: async (contentLength) => {
      calls.push(`reserve:${contentLength}`)
      return { upload_url: uploadUrl, key: "uploads/video.mp4" }
    },
    uploadFile: async (url, uploadedFile, _signal, onProgress) => {
      calls.push(`put:${url}:${uploadedFile.size}`)
      onProgress(1, 2)
    },
    createJob: async (input) => {
      calls.push(`job:${input.input_key}:${input.target_size_bytes}:${input.idempotencyKey}`)
      return { jobId }
    },
    ...transportOverrides,
  }
  return { file, calls, transport }
}

function attempt(file: File, targetSizeBytes = 20_000_000) {
  return createVideoJobAttempt(file, targetSizeBytes, () => "video-job:stable-key")
}

describe("submitVideoJob", () => {
  it("uploads the selected file before creating a job and reports real upload progress", async () => {
    const { file, calls, transport } = fixture()
    const currentAttempt = attempt(file)
    const progress: number[] = []
    const phases: string[] = []

    const result = await submitVideoJob({
      file,
      targetSizeBytes: 20_000_000,
      attempt: currentAttempt,
      transport,
      onProgress: (percent) => progress.push(percent),
      onPhase: (phase) => phases.push(phase),
    })

    assert.deepEqual(calls, [
      `reserve:${file.size}`,
      `put:${uploadUrl}:${file.size}`,
      "job:uploads/video.mp4:20000000:video-job:stable-key",
    ])
    assert.deepEqual(progress, [50, 100])
    assert.deepEqual(phases, ["uploading", "submitting", "queued"])
    assert.equal(currentAttempt.inputKey, "uploads/video.mp4")
    assert.equal(currentAttempt.jobId, jobId)
    assert.equal(result.jobId, jobId)
  })

  it("reuses the completed upload key and idempotency key after an uncertain job response", async () => {
    let createCalls = 0
    const { file, calls, transport } = fixture({
      createJob: async ({ input_key, idempotencyKey }) => {
        calls.push(`job:${input_key}:${idempotencyKey}`)
        createCalls += 1
        if (createCalls === 1) throw new Error("The job response was lost")
        return { jobId }
      },
    })
    const currentAttempt = attempt(file)

    await assert.rejects(submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport }))
    const result = await submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport })

    assert.deepEqual(calls, [
      `reserve:${file.size}`,
      `put:${uploadUrl}:${file.size}`,
      "job:uploads/video.mp4:video-job:stable-key",
      "job:uploads/video.mp4:video-job:stable-key",
    ])
    assert.equal(result.jobId, jobId)
  })

  it("rejects simultaneous submissions for one attempt before duplicate network work", async () => {
    const { file, calls, transport } = fixture()
    let releaseCreate!: (value: { jobId: string }) => void
    transport.createJob = (input) => {
      calls.push(`job:${input.idempotencyKey}`)
      return new Promise((resolve) => { releaseCreate = resolve })
    }
    const currentAttempt = attempt(file)
    const first = submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport })
    await assert.rejects(
      submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport }),
      /already being submitted/i,
    )
    releaseCreate({ jobId })
    await first
    assert.equal(calls.filter((call) => call.startsWith("reserve:")).length, 1)
    assert.equal(calls.filter((call) => call.startsWith("job:")).length, 1)
  })

  it("does not upload or create another job after the attempt has succeeded", async () => {
    const { file, calls, transport } = fixture()
    const currentAttempt = attempt(file)
    await submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport })
    const before = calls.length

    const result = await submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport })

    assert.equal(result.jobId, jobId)
    assert.equal(calls.length, before)
  })

  it("refuses to reuse an attempt for a different file or target", async () => {
    const { file, calls, transport } = fixture()
    const currentAttempt = attempt(file)
    const otherFile = new File(["different"], "other.mp4", { type: "video/mp4" })

    await assert.rejects(submitVideoJob({ file: otherFile, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport }), /changed/i)
    await assert.rejects(submitVideoJob({ file, targetSizeBytes: 10_000_000, attempt: currentAttempt, transport }), /changed/i)
    assert.equal(calls.length, 0)
  })

  it("rejects unsafe upload URLs and keys before sending file bytes", async () => {
    const { file, calls, transport } = fixture({
      createUpload: async () => ({ upload_url: "http://evil.example/upload", key: "uploads/video.mp4" }),
    })

    await assert.rejects(submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: attempt(file), transport }), /upload URL/i)
    assert.equal(calls.some((call) => call.startsWith("put:")), false)
    assert.equal(calls.some((call) => call.startsWith("job:")), false)
  })

  it("accepts loopback HTTP for local storage stand-ins", async () => {
    const { file, calls, transport } = fixture({
      createUpload: async () => ({ upload_url: "http://localhost:4909/storage/upload", key: "uploads/video.mp4" }),
    })

    const result = await submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: attempt(file), transport })

    assert.equal(result.jobId, jobId)
    assert.ok(calls.some((call) => call.startsWith("put:http://localhost:4909/")))
  })
  it("requires an explicit retry after upload failure and keeps the same job identity", async () => {
    let uploadAttempts = 0
    const { file, calls, transport } = fixture({
      uploadFile: async (url, uploadedFile, _signal, onProgress) => {
        uploadAttempts += 1
        calls.push(`put:${url}:${uploadedFile.size}`)
        if (uploadAttempts === 1) throw new Error("The upload connection failed")
        onProgress(uploadedFile.size, uploadedFile.size)
      },
    })
    const currentAttempt = attempt(file)

    await assert.rejects(submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport }), /upload connection failed/i)
    const result = await submitVideoJob({ file, targetSizeBytes: 20_000_000, attempt: currentAttempt, transport })

    assert.deepEqual(calls, [
      `reserve:${file.size}`,
      `put:${uploadUrl}:${file.size}`,
      `reserve:${file.size}`,
      `put:${uploadUrl}:${file.size}`,
      "job:uploads/video.mp4:20000000:video-job:stable-key",
    ])
    assert.equal(result.jobId, jobId)
  })

})
