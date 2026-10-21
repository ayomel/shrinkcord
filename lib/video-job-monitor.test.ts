import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ShrinkcordApiError } from "./shrinkcord-api-client.ts"
import {
  cancelVideoJob,
  getVideoJob,
  monitorVideoJob,
  VideoJobMonitorError,
} from "./video-job-monitor.ts"
import type { ShrinkcordApiTransport, ShrinkcordJob } from "./shrinkcord-api-client.ts"

const jobId = "123e4567-e89b-42d3-a456-426614174000"
const otherJobId = "123e4567-e89b-42d3-b456-426614174001"
const baseUrl = "http://api.test"

function job(overrides: Partial<ShrinkcordJob> = {}): ShrinkcordJob {
  return {
    id: jobId,
    status: "PROCESSING",
    progress: 35,
    target_size_bytes: 20_000_000,
    source_bytes: 1000,
    output_bytes: null,
    error_message: null,
    ...overrides,
  }
}

function transport(handler: (count: number) => ShrinkcordJob | Error): ShrinkcordApiTransport {
  let getCount = 0
  return {
    uploadJob: async () => ({ id: jobId }),
    getJob: async () => {
      getCount += 1
      const result = handler(getCount)
      if (result instanceof Error) throw result
      return result
    },
    cancelJob: async () => job({ status: "CANCELED", progress: 70 }),
    downloadJobFile: async () => new Blob(),
  }
}

describe("video job monitor", () => {
  it("reads a validated job from the API transport", async () => {
    const api = transport(() => job())
    const result = await getVideoJob(jobId, undefined, baseUrl, api)
    assert.equal(result.id, jobId)
    assert.equal(result.progress, 35)
  })

  it("rejects a mismatched job ID and malformed status or progress", async () => {
    const api = transport(() => job({ id: otherJobId }))
    await assert.rejects(getVideoJob(jobId, undefined, baseUrl, api), (error: unknown) => {
      assert.ok(error instanceof VideoJobMonitorError)
      assert.equal(error.code, "invalid_response")
      return true
    })
    const badStatus = transport(() => job({ status: "RUNNING" as ShrinkcordJob["status"] }))
    await assert.rejects(getVideoJob(jobId, undefined, baseUrl, badStatus), /invalid response/i)
  })

  it("accepts fractional API progress values", async () => {
    const api = transport(() => job({ progress: 12.7 as unknown as number }))
    const result = await getVideoJob(jobId, undefined, baseUrl, api)
    assert.equal(result.progress, 13)
  })

  it("retries recoverable errors while polling and ends at completion", async () => {
    const progress: number[] = []
    const api = transport((count) => {
      if (count === 1) return job({ progress: 94 })
      if (count === 2) return job({ progress: 8 })
      return job({ status: "COMPLETED", progress: 40, output_bytes: 500 })
    })

    const terminal = await monitorVideoJob(jobId, {
      baseUrl,
      transport: api,
      pollIntervalMs: 1,
      onJob: (current) => progress.push(current.progress),
    })

    assert.equal(terminal?.status, "COMPLETED")
    assert.deepEqual(progress, [94, 8, 100])
  })

  it("caps nonterminal progress below 100", async () => {
    const seen: number[] = []
    let calls = 0
    const api = transport(() => {
      calls += 1
      return calls === 1 ? job({ progress: 100 }) : job({ status: "FAILED", progress: 100, error_message: "nope" })
    })

    const terminal = await monitorVideoJob(jobId, {
      baseUrl,
      transport: api,
      pollIntervalMs: 1,
      onJob: (current) => seen.push(current.progress),
    })

    assert.equal(terminal?.status, "FAILED")
    assert.deepEqual(seen, [99, 99])
  })

  it("stops polling on a non-recoverable 400", async () => {
    const api = transport(() => new ShrinkcordApiError("unknown", "bad id", { status: 400, retryable: false }))
    await assert.rejects(monitorVideoJob(jobId, {
      baseUrl,
      transport: api,
      pollIntervalMs: 1,
    }), (error: unknown) => {
      assert.ok(error instanceof VideoJobMonitorError)
      assert.equal(error.recoverable, false)
      return true
    })
  })

  it("aborts the wait cleanly", async () => {
    const controller = new AbortController()
    let callbacks = 0
    const api = transport(() => job())
    const monitoring = monitorVideoJob(jobId, {
      baseUrl,
      transport: api,
      pollIntervalMs: 100,
      signal: controller.signal,
      onJob: () => {
        callbacks += 1
        controller.abort()
      },
    })
    const terminal = await monitoring
    assert.equal(terminal, undefined)
    assert.equal(callbacks, 1)
  })

  it("does not overlap status requests while polling", async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    const api: ShrinkcordApiTransport = {
      uploadJob: async () => ({ id: jobId }),
      getJob: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        calls += 1
        return calls === 1 ? job() : job({ status: "COMPLETED", progress: 100 })
      },
      cancelJob: async () => job({ status: "CANCELED" }),
      downloadJobFile: async () => new Blob(),
    }
    await monitorVideoJob(jobId, { baseUrl, transport: api, pollIntervalMs: 1 })
    assert.equal(maxActive, 1)
  })

  it("cancel returns the authoritative canceled job", async () => {
    const api = transport(() => job())
    const latest = await cancelVideoJob(jobId, undefined, baseUrl, api)
    assert.equal(latest.status, "CANCELED")
    assert.equal(latest.progress, 70)
  })
})
