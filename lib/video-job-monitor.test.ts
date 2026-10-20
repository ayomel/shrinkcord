import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { describe, it } from "node:test"
import {
  cancelVideoJob,
  getVideoJob,
  monitorVideoJob,
  VideoJobMonitorError,
  type VideoJob,
} from "./video-job-monitor.ts"

const jobId = "123e4567-e89b-42d3-a456-426614174000"
const otherJobId = "123e4567-e89b-42d3-b456-426614174001"

type Handler = (request: Request, count: number) => Response | Promise<Response>

async function withApi(handler: Handler, run: (fetchImpl: typeof fetch, calls: string[]) => Promise<void>) {
  const calls: string[] = []
  let requestCount = 0
  const server = createServer(async (request, response) => {
    requestCount += 1
    calls.push(`${request.method} ${request.url}`)
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString("utf8")
    const result = await handler(new Request(`http://localhost${request.url}`, {
      method: request.method,
      headers: request.headers as HeadersInit,
      body: body || undefined,
    }), requestCount)
    response.statusCode = result.status
    result.headers.forEach((value, key) => response.setHeader(key, value))
    response.end(await result.text())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const baseUrl = `http://127.0.0.1:${address.port}`
  const fetchImpl: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    return fetch(new URL(url, baseUrl), init)
  }
  try {
    await run(fetchImpl, calls)
  } finally {
    server.close()
    await once(server, "close")
  }
}

function job(overrides: Partial<VideoJob> = {}): VideoJob {
  return {
    id: jobId,
    status: "PROCESSING",
    progress: 35,
    attempts: 1,
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

describe("video job monitor", () => {
  it("reads a validated job over same-origin HTTP with uncached, credential-free requests", async () => {
    await withApi(() => json(job()), async (fetchImpl) => {
      const requestOptions: RequestInit[] = []
      const observingFetch: typeof fetch = (input, init) => {
        requestOptions.push(init ?? {})
        return fetchImpl(input, init)
      }

      const result = await getVideoJob(jobId, undefined, observingFetch)

      assert.equal(result.id, jobId)
      assert.equal(result.progress, 35)
      assert.deepEqual(requestOptions.map(({ method, cache, credentials, redirect }) => ({ method, cache, credentials, redirect })), [
        { method: "GET", cache: "no-store", credentials: "omit", redirect: "error" },
      ])
    })
  })

  it("rejects a mismatched job ID and malformed status or progress", async () => {
    await withApi(() => json(job({ id: otherJobId })), async (fetchImpl) => {
      await assert.rejects(getVideoJob(jobId, undefined, fetchImpl), (error: unknown) => {
        assert.ok(error instanceof VideoJobMonitorError)
        assert.equal(error.code, "invalid_response")
        return true
      })
    })
    await withApi(() => json(job({ status: "RUNNING" as VideoJob["status"] })), async (fetchImpl) => {
      await assert.rejects(getVideoJob(jobId, undefined, fetchImpl), /invalid response/i)
    })
    await withApi(() => json(job({ progress: 101 })), async (fetchImpl) => {
      await assert.rejects(getVideoJob(jobId, undefined, fetchImpl), /invalid response/i)
    })
  })

  it("retries network and HTTP failures, allows backend retry progress resets, and ends at completion", async () => {
    const progress: number[] = []
    const errors: string[] = []
    await withApi((_request, count) => {
      if (count === 1) return json({ message: "private upstream detail" }, 503)
      if (count === 2) return json({ message: "rate limit" }, 429)
      if (count === 3) return json(job({ progress: 94, attempts: 1 }))
      if (count === 4) return json(job({ progress: 8, attempts: 2 }))
      return json(job({ status: "COMPLETED", progress: 40, attempts: 2 }))
    }, async (fetchImpl) => {
      let failNetworkOnce = true
      const flakyFetch: typeof fetch = (input, init) => {
        if (failNetworkOnce) {
          failNetworkOnce = false
          return Promise.reject(new TypeError("connection reset with private detail"))
        }
        return fetchImpl(input, init)
      }
      const terminal = await monitorVideoJob(jobId, {
        fetchImpl: flakyFetch,
        pollIntervalMs: 1,
        onJob: (current) => progress.push(current.progress),
        onError: (error) => errors.push(error.message),
      })

      assert.equal(terminal?.status, "COMPLETED")
      assert.deepEqual(progress, [94, 8, 100])
      assert.equal(errors.length, 3)
      assert.ok(errors.every((message) => message.length <= 160))
      assert.ok(errors.every((message) => !message.includes("private upstream detail")))
    })
  })

  it("recovers from a status body interrupted by a temporary network failure", async () => {
    const errors: VideoJobMonitorError[] = []
    await withApi(() => json(job({ status: "COMPLETED", progress: 100 })), async (fetchImpl) => {
      let interruptBodyOnce = true
      const flakyFetch: typeof fetch = (input, init) => {
        if (interruptBodyOnce) {
          interruptBodyOnce = false
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new TypeError("connection reset with private detail"))
            },
          })
          return Promise.resolve(new Response(body, { status: 200 }))
        }
        return fetchImpl(input, init)
      }

      const terminal = await monitorVideoJob(jobId, {
        fetchImpl: flakyFetch,
        pollIntervalMs: 1,
        onError: (error) => errors.push(error),
      })

      assert.equal(terminal?.status, "COMPLETED")
      assert.equal(errors.length, 1)
      assert.equal(errors[0]?.recoverable, true)
    })
  })

  it("caps nonterminal progress below 100 and reports terminal states once", async () => {
    const seen: VideoJob[] = []
    await withApi((_request, count) => count === 1
      ? json(job({ progress: 100 }))
      : json(job({ status: "FAILED", progress: 100, error_message: "Compression failed." })), async (fetchImpl, calls) => {
      const terminal = await monitorVideoJob(jobId, {
        fetchImpl,
        pollIntervalMs: 1,
        onJob: (current) => seen.push(current),
      })

      assert.equal(terminal?.status, "FAILED")
      assert.deepEqual(seen.map(({ status, progress }) => [status, progress]), [
        ["PROCESSING", 99],
        ["FAILED", 99],
      ])
      assert.equal(calls.length, 2)
    })
  })

  it("does not overlap status requests while polling", async () => {
    let activeRequests = 0
    let maximumActiveRequests = 0
    await withApi(async (_request, count) => {
      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
      await new Promise((resolve) => setTimeout(resolve, 12))
      activeRequests -= 1
      return json(count === 1 ? job() : job({ status: "COMPLETED", progress: 100 }))
    }, async (fetchImpl) => {
      const terminal = await monitorVideoJob(jobId, { fetchImpl, pollIntervalMs: 1 })
      assert.equal(terminal?.status, "COMPLETED")
      assert.equal(maximumActiveRequests, 1)
    })
  })

  it("stops with an actionable typed error when the job is missing", async () => {
    await withApi(() => json({ message: "database internal info" }, 404), async (fetchImpl) => {
      await assert.rejects(monitorVideoJob(jobId, {
        fetchImpl,
        onJob: () => assert.fail("a missing job cannot produce a job callback"),
      }), (error: unknown) => {
        assert.ok(error instanceof VideoJobMonitorError)
        assert.equal(error.code, "http_error")
        assert.equal(error.status, 404)
        assert.equal(error.recoverable, false)
        assert.ok(error.message.length <= 160)
        assert.ok(!error.message.includes("database internal info"))
        return true
      })
    })
  })

  it("stops on a bad job request with a short typed error", async () => {
    await withApi(() => json({ detail: "sensitive server traceback" }, 400), async (fetchImpl) => {
      await assert.rejects(getVideoJob(jobId, undefined, fetchImpl), (error: unknown) => {
        assert.ok(error instanceof VideoJobMonitorError)
        assert.equal(error.status, 400)
        assert.equal(error.recoverable, false)
        assert.ok(error.message.length <= 160)
        assert.ok(!error.message.includes("sensitive server traceback"))
        return true
      })
    })
  })

  it("aborts the wait cleanly and never reports another job after abort", async () => {
    let jobCallbacks = 0
    const controller = new AbortController()
    await withApi(() => json(job()), async (fetchImpl, calls) => {
      const monitoring = monitorVideoJob(jobId, {
        fetchImpl,
        pollIntervalMs: 100,
        signal: controller.signal,
        onJob: () => {
          jobCallbacks += 1
          setTimeout(() => controller.abort(), 5)
        },
      })

      const terminal = await monitoring
      assert.equal(terminal, undefined)
      await new Promise((resolve) => setTimeout(resolve, 120))
      assert.equal(jobCallbacks, 1)
      assert.equal(calls.length, 1)
    })
  })

  it("reconciles cancel conflicts by reading the authoritative latest job", async () => {
    await withApi((request) => request.method === "POST"
      ? json({ message: "already terminal" }, 409)
      : json(job({ status: "COMPLETED", progress: 100 })), async (fetchImpl, calls) => {
      const latest = await cancelVideoJob(jobId, undefined, fetchImpl)
      assert.equal(latest.status, "COMPLETED")
      assert.deepEqual(calls, ["POST /api/jobs/123e4567-e89b-42d3-a456-426614174000/cancel", "GET /api/jobs/123e4567-e89b-42d3-a456-426614174000"])
    })
  })

  it("returns canceled only when the authoritative follow-up read says canceled", async () => {
    await withApi((request) => request.method === "POST"
      ? json({ message: "already terminal" }, 409)
      : json(job({ status: "CANCELED", progress: 70 })), async (fetchImpl) => {
      const latest = await cancelVideoJob(jobId, undefined, fetchImpl)
      assert.equal(latest.status, "CANCELED")
      assert.equal(latest.progress, 70)
    })
  })

  it("preserves a pending cancel response instead of claiming it is canceled", async () => {
    await withApi(() => json(job({ progress: 61 })), async (fetchImpl) => {
      const current = await cancelVideoJob(jobId, undefined, fetchImpl)
      assert.equal(current.status, "PROCESSING")
      assert.equal(current.progress, 61)
    })
  })
})
