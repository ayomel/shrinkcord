import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  fetchVideoJobOutput,
  getVideoOutputFileName,
  MAX_VIDEO_OUTPUT_BYTES,
  VideoOutputError,
} from "./video-job-output.ts"

const jobId = "123e4567-e89b-42d3-a456-426614174000"
const baseUrl = "http://localhost:4909"
const outputUrl = "https://storage.example.test/output?signature=temporary"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function videoResponse(bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), headers: HeadersInit = {}) {
  const responseHeaders = new Headers({ "Content-Type": "video/mp4" })
  new Headers(headers).forEach((value, key) => responseHeaders.set(key, value))
  return new Response(bytes, {
    headers: responseHeaders,
  })
}

function options(fetcher: typeof fetch) {
  return { fetcher, apiBaseUrl: baseUrl }
}

describe("fetchVideoJobOutput", () => {
  it("fetches a signed URL without credentials and returns measured bytes as a Blob", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const result = await fetchVideoJobOutput(jobId, options(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      return url.endsWith("/download")
        ? jsonResponse({ url: outputUrl })
        : videoResponse()
    }))

    assert.equal(result.bytes, 8)
    assert.equal(result.blob.size, result.bytes)
    assert.equal(result.blob.type, "video/mp4")
    assert.deepEqual(calls.map(({ url }) => url), [`${baseUrl}/api/jobs/${jobId}/download`, outputUrl])
    assert.equal(calls[0]?.init?.credentials, "omit")
    assert.equal(calls[0]?.init?.redirect, "error")
    assert.equal(calls[1]?.init?.credentials, "omit")
    assert.equal(calls[1]?.init?.redirect, "error")
  })

  it("passes the signed URL through unchanged after safety validation", async () => {
    const signedUrl = "https://STORAGE.example.test/output?signature=raw%2fvalue"
    let storageUrl = ""
    await fetchVideoJobOutput(jobId, options(async (input) => {
      const url = String(input)
      if (url.endsWith("/download")) return jsonResponse({ url: signedUrl })
      storageUrl = url
      return videoResponse()
    }))

    assert.equal(storageUrl, signedUrl)
  })

  it("refreshes a signed URL once after storage rejects it as expired", async () => {
    const calls: string[] = []
    const result = await fetchVideoJobOutput(jobId, options(async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith("/download")) {
        return jsonResponse({ url: calls.filter((item) => item.endsWith("/download")).length === 1
          ? "https://storage.example.test/old"
          : outputUrl })
      }
      return url.endsWith("/old") ? new Response(null, { status: 403 }) : videoResponse()
    }))

    assert.equal(result.bytes, 8)
    assert.deepEqual(calls, [
      `${baseUrl}/api/jobs/${jobId}/download`,
      "https://storage.example.test/old",
      `${baseUrl}/api/jobs/${jobId}/download`,
      outputUrl,
    ])
  })

  it("does not fetch storage after the API marks the output expired", async () => {
    const calls: string[] = []
    await assert.rejects(
      fetchVideoJobOutput(jobId, options(async (input) => {
        calls.push(String(input))
        return jsonResponse({ detail: "expired" }, 410)
      })),
      (error: unknown) => error instanceof VideoOutputError && error.status === 410 && error.expired,
    )
    assert.deepEqual(calls, [`${baseUrl}/api/jobs/${jobId}/download`])
  })

  it("reports a completed job that is not ready yet without fetching storage", async () => {
    let storageCalls = 0
    await assert.rejects(
      fetchVideoJobOutput(jobId, options(async (_input, init) => {
        if (init?.method === "GET") storageCalls += 1
        return jsonResponse({ detail: "not ready" }, 409)
      })),
      (error: unknown) => error instanceof VideoOutputError && error.status === 409 && !error.expired,
    )
    assert.equal(storageCalls, 1)
  })

  it("rejects unsafe signed URLs before making storage requests", async () => {
    for (const url of [
      "http://storage.example.test/output",
      "https://user:pass@storage.example.test/output",
      "https://storage.example.test/output#fragment",
      "ftp://storage.example.test/output",
    ]) {
      let storageCalls = 0
      await assert.rejects(
        fetchVideoJobOutput(jobId, options(async (input) => {
          if (String(input).endsWith("/download")) return jsonResponse({ url })
          storageCalls += 1
          return videoResponse()
        })),
        /unsafe output URL/i,
        url,
      )
      assert.equal(storageCalls, 0, url)
    }
  })

  it("allows loopback HTTP for controlled storage simulations", async () => {
    const localUrl = "http://127.0.0.1:4909/storage/output"
    const result = await fetchVideoJobOutput(jobId, options(async (input) => String(input).endsWith("/download")
      ? jsonResponse({ url: localUrl })
      : videoResponse()))

    assert.equal(result.bytes, 8)
  })

  it("rejects output larger than the configured maximum from its declared length", async () => {
    await assert.rejects(
      fetchVideoJobOutput(jobId, options(async (input) => String(input).endsWith("/download")
        ? jsonResponse({ url: outputUrl })
        : videoResponse(new Uint8Array([0]), { "Content-Length": String(MAX_VIDEO_OUTPUT_BYTES + 1) }))),
      /exceeds the 500 MiB download limit/i,
    )
  })

  it("enforces the byte limit against streamed bytes even when the length is missing", async () => {
    const repeatedChunk = new Uint8Array(1024 * 1024)
    let chunksSent = 0
    const oversizedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksSent += 1
        controller.enqueue(repeatedChunk)
        if (chunksSent > MAX_VIDEO_OUTPUT_BYTES / repeatedChunk.byteLength) controller.close()
      },
    })

    await assert.rejects(
      fetchVideoJobOutput(jobId, options(async (input) => String(input).endsWith("/download")
        ? jsonResponse({ url: outputUrl })
        : new Response(oversizedStream, { headers: { "Content-Type": "video/mp4" } }))),
      /exceeds the 500 MiB download limit/i,
    )
  })

  it("accepts a valid MP4 payload served as application/octet-stream", async () => {
    const result = await fetchVideoJobOutput(jobId, options(async (input) => String(input).endsWith("/download")
      ? jsonResponse({ url: outputUrl })
      : videoResponse(new Uint8Array([1, 2, 3]), { "Content-Type": "application/octet-stream" })))

    assert.equal(result.bytes, 3)
    assert.equal(result.blob.type, "video/mp4")
  })

  it("rejects an HTML error page even when storage labels it as binary", async () => {
    await assert.rejects(
      fetchVideoJobOutput(jobId, options(async (input) => String(input).endsWith("/download")
        ? jsonResponse({ url: outputUrl })
        : new Response("  <!doctype html><html><body>expired</body></html>", {
          headers: { "Content-Type": "application/octet-stream" },
        }))),
      /error page instead of an MP4/i,
    )
  })

  it("rejects empty output and content types outside MP4 and octet-stream", async () => {
    for (const { response, message } of [
      { response: () => new Response(null, { headers: { "Content-Type": "video/mp4" } }), message: /empty video file/i },
      { response: () => new Response("not a video", { headers: { "Content-Type": "text/plain" } }), message: /not an MP4 video/i },
    ]) {
      await assert.rejects(
        fetchVideoJobOutput(jobId, options(async (input) => String(input).endsWith("/download")
          ? jsonResponse({ url: outputUrl })
          : response())),
        message,
      )
    }
  })

  it("aborts an in-progress storage download when the caller cancels", async () => {
    const controller = new AbortController()
    const pendingDownload = new Promise<Response>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true })
    })
    const result = fetchVideoJobOutput(jobId, {
      ...options(async (input) => String(input).endsWith("/download") ? jsonResponse({ url: outputUrl }) : pendingDownload),
      signal: controller.signal,
    })
    controller.abort()
    await assert.rejects(result, (error: unknown) => error instanceof DOMException && error.name === "AbortError")
  })

  it("creates a safe, readable MP4 name from an input file name", () => {
    assert.equal(getVideoOutputFileName("C:\\Users\\me\\My clip.mov"), "My clip-discord.mp4")
    assert.equal(getVideoOutputFileName("archive"), "archive-discord.mp4")
  })
})
