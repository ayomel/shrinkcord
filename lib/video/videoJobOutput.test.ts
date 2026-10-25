import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  fetchVideoJobOutput,
  getVideoOutputFileName,
  MAX_VIDEO_OUTPUT_BYTES,
} from "./videoJobOutput.ts"

const jobId = "123e4567-e89b-42d3-a456-426614174000"
const baseUrl = "http://api.test"

const mp4Bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])

function settleWithin<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The download did not settle promptly.")), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

describe("getVideoOutputFileName", () => {
  it("adds -discord.mp4 to the stem", () => {
    assert.equal(getVideoOutputFileName("vacation.MP4"), "vacation-discord.mp4")
    assert.equal(getVideoOutputFileName("clip.mov"), "clip-discord.mp4")
  })
})

describe("fetchVideoJobOutput", () => {
  it("downloads directly from the signed URL without requesting the job file endpoint", async () => {
    const signedUrl = "https://storage.test/output.mp4?signature=keep%2Bexact&expires=123"
    const requests: string[] = []
    const progress: Array<{ loaded: number; total: number | null }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      requests.push(String(input))
      return new Response(mp4Bytes, {
        status: 200,
        headers: { "Content-Type": "video/mp4", "Content-Length": String(mp4Bytes.byteLength) },
      })
    }
    try {
      const output = await fetchVideoJobOutput(jobId, {
        apiBaseUrl: baseUrl,
        downloadUrl: signedUrl,
        onProgress: (loaded, total) => progress.push({ loaded, total }),
      })
      assert.equal(output.bytes, mp4Bytes.byteLength)
      assert.deepEqual(requests, [signedUrl])
      assert.ok(progress.some((entry) => entry.loaded === mp4Bytes.byteLength))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("downloads with Content-Length progress", async () => {
    const progress: Array<{ loaded: number; total: number | null }> = []
    const requests: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      requests.push(String(input))
      return new Response(mp4Bytes, {
        status: 200,
        headers: { "Content-Type": "video/mp4", "Content-Length": String(mp4Bytes.byteLength) },
      })
    }
    try {
      const output = await fetchVideoJobOutput(jobId, {
        apiBaseUrl: baseUrl,
        onProgress: (loaded, total) => progress.push({ loaded, total }),
      })
      assert.equal(output.bytes, mp4Bytes.byteLength)
      assert.deepEqual(requests, [`${baseUrl}/jobs/${jobId}/file`])
      assert.ok(progress.some((entry) => entry.loaded === mp4Bytes.byteLength))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("rejects empty output bodies", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(new Uint8Array(), {
      status: 200,
      headers: { "Content-Type": "video/mp4", "Content-Length": "0" },
    })
    try {
      await assert.rejects(fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl }), /empty/i)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("aborts when the caller signal aborts", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return new Response(mp4Bytes, { status: 200, headers: { "Content-Type": "video/mp4" } })
    }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    try {
      await assert.rejects(
        fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl, downloadUrl: "https://storage.test/output.mp4?sig=cancel", signal: controller.signal }),
        (error: unknown) => error instanceof DOMException && error.name === "AbortError",
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("rejects downloads above the output byte cap", async () => {
    const originalFetch = globalThis.fetch
    const huge = new Uint8Array(MAX_VIDEO_OUTPUT_BYTES + 1)
    globalThis.fetch = async () => new Response(huge, { status: 200, headers: { "Content-Type": "video/mp4" } })
    try {
      await assert.rejects(fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl, downloadUrl: "https://storage.test/output.mp4?sig=cap" }), /500 MiB/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("rejects an oversized Content-Length before reading the response body", async () => {
    const originalFetch = globalThis.fetch
    let reads = 0
    const body = {
      getReader: () => ({
        read: async () => {
          reads += 1
          return { done: true, value: undefined }
        },
        cancel: async () => {},
        releaseLock() {},
      }),
      cancel: async () => {},
    } as unknown as ReadableStream<Uint8Array>
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Length": String(MAX_VIDEO_OUTPUT_BYTES + 1) }),
      body,
    }) as Response
    try {
      await assert.rejects(
        fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl }),
        /500 MiB/,
      )
      assert.equal(reads, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("stops a streamed response as soon as cumulative bytes exceed the output cap", async () => {
    const originalFetch = globalThis.fetch
    let canceled = false
    let reads = 0
    const oversizedChunk = { byteLength: MAX_VIDEO_OUTPUT_BYTES + 1 } as Uint8Array
    const body = {
      getReader: () => ({
        read: async () => {
          reads += 1
          if (reads > 1) return { done: true, value: undefined }
          return { done: false, value: oversizedChunk }
        },
        cancel: async () => {
          canceled = true
        },
        releaseLock() {},
      }),
    } as unknown as ReadableStream<Uint8Array>
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Length": "1" }),
      body,
    }) as Response
    try {
      await assert.rejects(
        fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl }),
        /500 MiB/,
      )
      assert.equal(reads, 1)
      assert.equal(canceled, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("treats an expired signed storage URL as unavailable", async () => {
    const originalFetch = globalThis.fetch
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      requests.push(String(input))
      return new Response(null, { status: 403 })
    }
    try {
      await assert.rejects(
        fetchVideoJobOutput(jobId, {
          apiBaseUrl: baseUrl,
          downloadUrl: "https://storage.test/output.mp4?sig=expired",
        }),
        (error: unknown) => {
          assert.equal((error as { expired?: boolean }).expired, true)
          return true
        },
      )
      assert.deepEqual(requests, ["https://storage.test/output.mp4?sig=expired"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("cancels a blocked stream read when the caller aborts", async () => {
    const originalFetch = globalThis.fetch
    let canceled = false
    const body = {
      getReader: () => ({
        read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
        cancel: async () => {
          canceled = true
        },
        releaseLock() {},
      }),
    } as unknown as ReadableStream<Uint8Array>
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body,
    }) as Response
    const controller = new AbortController()
    const download = fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl, signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    try {
      await assert.rejects(download, (error: unknown) => error instanceof DOMException && error.name === "AbortError")
      assert.equal(canceled, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("reports a stalled stream timeout as retryable", async () => {
    const originalFetch = globalThis.fetch
    const originalTimeout = AbortSignal.timeout
    const timeoutController = new AbortController()
    const body = {
      getReader: () => ({
        read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
        cancel: async () => {},
        releaseLock() {},
      }),
    } as unknown as ReadableStream<Uint8Array>
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body,
    }) as Response
    AbortSignal.timeout = () => timeoutController.signal
    const download = fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl })
    setTimeout(() => timeoutController.abort(), 5)
    try {
      await assert.rejects(download, (error: unknown) => {
        assert.equal((error as { retryable?: boolean }).retryable, true)
        assert.match((error as Error).message, /timed out/i)
        return true
      })
    } finally {
      globalThis.fetch = originalFetch
      AbortSignal.timeout = originalTimeout
    }
  })

  it("maps a body stream read failure to a retryable network error", async () => {
    const originalFetch = globalThis.fetch
    const body = {
      getReader: () => ({
        read: async () => {
          throw new Error("connection reset")
        },
        cancel: async () => {},
        releaseLock() {},
      }),
    } as unknown as ReadableStream<Uint8Array>
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body,
    }) as Response
    try {
      await assert.rejects(fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl }), (error: unknown) => {
        assert.equal((error as { retryable?: boolean }).retryable, true)
        assert.match((error as Error).message, /connection/i)
        return true
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("settles promptly when aborting a native stream whose cancel never resolves", async () => {
    const originalFetch = globalThis.fetch
    const body = new ReadableStream<Uint8Array>({
      pull() {},
      cancel: () => new Promise<void>(() => {}),
    })
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body,
    }) as Response
    const controller = new AbortController()
    const download = fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl, signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    try {
      await assert.rejects(
        settleWithin(download),
        (error: unknown) => error instanceof DOMException && error.name === "AbortError",
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("rejects an oversized header promptly when stream cancellation never resolves", async () => {
    const originalFetch = globalThis.fetch
    const body = new ReadableStream<Uint8Array>({
      pull() {},
      cancel: () => new Promise<void>(() => {}),
    })
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Length": String(MAX_VIDEO_OUTPUT_BYTES + 1) }),
      body,
    }) as Response
    try {
      await assert.rejects(settleWithin(fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl })), /500 MiB/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("rejects stream overflow promptly when stream cancellation never resolves", async () => {
    const originalFetch = globalThis.fetch
    const oversizedChunk = { byteLength: MAX_VIDEO_OUTPUT_BYTES + 1 } as Uint8Array
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversizedChunk)
      },
      cancel: () => new Promise<void>(() => {}),
    })
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Length": "1" }),
      body,
    }) as Response
    try {
      await assert.rejects(settleWithin(fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl })), /500 MiB/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
