import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  mapHttpStatusToError,
  uploadJobWithXhr,
  uploadShrinkcordJob,
} from "./shrinkcord-api-client.ts"

const jobId = "123e4567-e89b-42d3-a456-426614174000"

describe("mapHttpStatusToError", () => {
  it("maps common API statuses to user-facing codes", () => {
    assert.equal(mapHttpStatusToError(413, "").code, "too_large")
    assert.equal(mapHttpStatusToError(415, "").code, "unsupported")
    assert.equal(mapHttpStatusToError(429, "").code, "server_busy")
    assert.equal(mapHttpStatusToError(400, "duration exceeds 600").code, "too_long")
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

describe("cancelShrinkcordJob", () => {
  it("DELETEs the job and returns the latest job record", async () => {
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ id: jobId, status: "CANCELED" }), { status: 200 })
      }
      return new Response(
        JSON.stringify({
          id: jobId,
          status: "CANCELED",
          progress: 12,
          target_size_bytes: 20_000_000,
          source_bytes: 100,
          output_bytes: null,
          error_message: null,
        }),
        { status: 200 },
      )
    }
    try {
      const { cancelShrinkcordJob } = await import("./shrinkcord-api-client.ts")
      const job = await cancelShrinkcordJob(jobId, undefined, "http://api.test")
      assert.equal(job.status, "CANCELED")
      assert.ok(calls.some((call) => call.startsWith("DELETE")))
      assert.ok(calls.some((call) => call.startsWith("GET")))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("uploadShrinkcordJob", () => {
  it("retries 429 responses before succeeding", async () => {
    let calls = 0
    const file = new File(["x"], "a.mp4", { type: "video/mp4" })
    const result = await uploadShrinkcordJob({
      file,
      rateLimitRetryDelayMs: 1,
      maxRateLimitRetries: 5,
      uploadImpl: async () => {
        calls += 1
        if (calls < 3) throw mapHttpStatusToError(429, "busy")
        return { id: jobId }
      },
    })
    assert.equal(result.id, jobId)
    assert.equal(calls, 3)
  })
})
