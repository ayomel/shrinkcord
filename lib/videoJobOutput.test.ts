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

describe("getVideoOutputFileName", () => {
  it("adds -discord.mp4 to the stem", () => {
    assert.equal(getVideoOutputFileName("vacation.MP4"), "vacation-discord.mp4")
    assert.equal(getVideoOutputFileName("clip.mov"), "clip-discord.mp4")
  })
})

describe("fetchVideoJobOutput", () => {
  it("downloads with Content-Length progress", async () => {
    const progress: Array<{ loaded: number; total: number | null }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(mp4Bytes, {
      status: 200,
      headers: { "Content-Type": "video/mp4", "Content-Length": String(mp4Bytes.byteLength) },
    })
    try {
      const output = await fetchVideoJobOutput(jobId, {
        apiBaseUrl: baseUrl,
        onProgress: (loaded, total) => progress.push({ loaded, total }),
      })
      assert.equal(output.bytes, mp4Bytes.byteLength)
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
        fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl, signal: controller.signal }),
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
      await assert.rejects(fetchVideoJobOutput(jobId, { apiBaseUrl: baseUrl }), /500 MiB/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
