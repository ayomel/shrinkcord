import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  cancelShrinkcordJob,
  extractErrorMessage,
  mapHttpStatusToError,
  parseRetryAfterMs,
  uploadJobWithXhr,
  uploadShrinkcordJob,
} from "./shrinkcord-api-client.ts"

const jobId = "123e4567-e89b-42d3-a456-426614174000"

describe("parseRetryAfterMs", () => {
  it("parses Retry-After seconds", () => {
    assert.equal(parseRetryAfterMs("5"), 5000)
  })
})

describe("mapHttpStatusToError", () => {
  it("uses friendly copy instead of raw server text", () => {
    const error = mapHttpStatusToError(
      429,
      '{"message":"Too many jobs in progress; try again later"}',
      5000,
    )
    assert.equal(error.message, "Server busy, retrying.")
    assert.equal(error.retryAfterMs, 5000)
    assert.equal(mapHttpStatusToError(413, "").message, "Choose a video that is 524.288 MiB (500 MiB) or smaller.")
  })

  it("maps 409 from HTTP status before body shape", () => {
    const legacy = mapHttpStatusToError(409, JSON.stringify({ message: "already done", status: 409 }))
    const nest = mapHttpStatusToError(
      409,
      JSON.stringify({ message: "already done", error: "Conflict", statusCode: 409 }),
    )
    assert.equal(legacy.message, "This job already finished.")
    assert.equal(nest.message, "This job already finished.")
  })

  it("refines 400 errors from legacy { message, status } bodies", () => {
    const body = JSON.stringify({ message: "duration exceeds limit", status: 400 })
    assert.equal(mapHttpStatusToError(400, body).code, "too_long")
    assert.equal(extractErrorMessage(body), "duration exceeds limit")
  })

  it("refines 400 errors from Nest { message, error, statusCode } bodies", () => {
    const body = JSON.stringify({
      message: "duration exceeds limit",
      error: "Bad Request",
      statusCode: 400,
    })
    assert.equal(mapHttpStatusToError(400, body).code, "too_long")
    assert.equal(extractErrorMessage(body), "duration exceeds limit")
  })
})

describe("uploadJobWithXhr", () => {
  it("reports upload progress and parses 201 job id", async () => {
    const progress: number[] = []
    const original = globalThis.XMLHttpRequest
    class MockXHR {
      upload = {
        addEventListener: (_: string, handler: (event: { lengthComputable: boolean; loaded: number; total: number }) => void) => {
          handler({ lengthComputable: true, loaded: 50, total: 100 })
        },
      }
      status = 201
      responseText = JSON.stringify({ id: jobId })
      getResponseHeader() {
        return null
      }
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.()
      }
      addEventListener(event: string, handler: () => void) {
        if (event === "load") this.onload = handler
      }
      onload?: () => void
      abort() {}
      withCredentials = false
      timeout = 0
    }
    globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest

    try {
      const file = new File(["video"], "clip.mp4", { type: "video/mp4" })
      const controller = new AbortController()
      const result = await uploadJobWithXhr(
        "http://localhost:3000/jobs",
        file,
        20_000_000,
        controller.signal,
        (loaded, total) => progress.push(Math.round((loaded / total) * 100)),
      )
      assert.equal(result.id, jobId)
      assert.deepEqual(progress, [50])
    } finally {
      globalThis.XMLHttpRequest = original
    }
  })
})

describe("uploadShrinkcordJob", () => {
  it("honours Retry-After between 429 responses", async () => {
    const delays: number[] = []
    let calls = 0
    const file = new File(["x"], "a.mp4", { type: "video/mp4" })
    const result = await uploadShrinkcordJob({
      file,
      baseUrl: "http://api.test",
      maxRateLimitRetries: 5,
      onRateLimited: (ms) => delays.push(ms),
      uploadImpl: async () => {
        calls += 1
        if (calls < 3) throw mapHttpStatusToError(429, "", 5000)
        return { id: jobId }
      },
    })
    assert.equal(result.id, jobId)
    assert.equal(calls, 3)
    assert.ok(delays.every((ms) => ms === 5000))
  })

  it("skips upload when existingJobId is provided", async () => {
    let calls = 0
    const file = new File(["x"], "a.mp4", { type: "video/mp4" })
    const result = await uploadShrinkcordJob({
      file,
      existingJobId: jobId,
      uploadImpl: async () => {
        calls += 1
        return { id: jobId }
      },
    })
    assert.equal(result.id, jobId)
    assert.equal(calls, 0)
  })
})

describe("cancelShrinkcordJob", () => {
  it("treats 409 as an already-finished job", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ message: "already COMPLETED" }), { status: 409 })
      }
      return new Response(
        JSON.stringify({
          id: jobId,
          status: "COMPLETED",
          progress: 100,
          target_size_bytes: 20_000_000,
          source_bytes: 1,
          output_bytes: 1,
          error_message: null,
        }),
        { status: 200 },
      )
    }
    try {
      const job = await cancelShrinkcordJob(jobId, undefined, "http://api.test")
      assert.equal(job?.status, "COMPLETED")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
