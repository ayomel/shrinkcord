import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  fetchVideoJobOutput,
  getVideoOutputFileName,
  MAX_VIDEO_OUTPUT_BYTES,
  VideoOutputError,
} from "./video-job-output.ts"

const jobId = "123e4567-e89b-42d3-a456-426614174000"
const baseUrl = "http://api.test"

const mp4Bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])

describe("getVideoOutputFileName", () => {
  it("adds -discord.mp4 to the stem", () => {
    assert.equal(getVideoOutputFileName("vacation.MP4"), "vacation-discord.mp4")
    assert.equal(getVideoOutputFileName("clip.mov"), "clip-discord.mp4")
  })
})

describe("fetchVideoJobOutput", () => {
  it("downloads the MP4 directly from GET /jobs/:id/file", async () => {
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      return new Response(mp4Bytes, { status: 200, headers: { "Content-Type": "video/mp4" } })
    }
    try {
      const output = await fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl })
      assert.equal(output.bytes, mp4Bytes.byteLength)
      assert.equal(output.blob.type, "video/mp4")
      assert.equal(calls[0], `${baseUrl}/jobs/${jobId}/file`)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("maps 404 to a non-retryable output error", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("missing", { status: 404 })
    try {
      await assert.rejects(fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl }), (error: unknown) => {
        assert.ok(error instanceof VideoOutputError)
        assert.equal(error.retryable, false)
        return true
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("rejects downloads above the output byte cap", async () => {
    const originalFetch = globalThis.fetch
    const huge = new Uint8Array(MAX_VIDEO_OUTPUT_BYTES + 1)
    globalThis.fetch = async () => new Response(huge, { status: 200, headers: { "Content-Type": "video/mp4" } })
    try {
      await assert.rejects(fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl }), /500 MiB/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
