import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { unzipSync } from "fflate"

import { downloadAll, DownloadAllError, MAX_DOWNLOAD_ALL_BYTES, downloadOne } from "./downloadQueue"
import type { VideoQueueItem } from "./types"

function video(id: string): VideoQueueItem {
  return {
    kind: "video",
    id,
    file: new File(["video"], "clip.mov", { type: "video/quicktime" }),
    status: "done",
    uploadProgress: 100,
    compressProgress: 100,
    downloadProgress: 100,
    downloadUrl: "data:application/octet-stream;base64,eA==",
  }
}

function captureDownloads() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document")
  const clicked: Array<{ href: string; download: string }> = []
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        const anchor = { href: "", download: "", click() { clicked.push({ href: this.href, download: this.download }) } }
        return anchor
      },
    },
  })
  return {
    clicked,
    restore() {
      if (previous) Object.defineProperty(globalThis, "document", previous)
      else Reflect.deleteProperty(globalThis, "document")
    },
  }
}

describe("queue downloads", () => {
  it("preserves the video filename and blob URL for a single download", () => {
    const browser = captureDownloads()
    try {
      const item = { ...video("one"), downloadUrl: "blob:video-output" }
      downloadOne(item)
      assert.deepEqual(browser.clicked, [{ href: "blob:video-output", download: "clip-discord.mp4" }])
    } finally {
      browser.restore()
    }
  })

  it("keeps every same-name output in the ZIP with distinct filenames", async (t) => {
    const browser = captureDownloads()
    let archive: Blob | undefined
    t.mock.method(URL, "createObjectURL", (blob: Blob) => {
      archive = blob
      return "blob:zip-output"
    })
    t.mock.method(URL, "revokeObjectURL", () => {})
    try {
      await downloadAll([video("one"), video("two"), video("three")])
      assert.ok(archive)
      assert.equal(archive.type, "application/zip")
      const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()))
      assert.deepEqual(Object.keys(entries), ["clip-discord.mp4", "clip-discord-2.mp4", "clip-discord-3.mp4"])
      for (const bytes of Object.values(entries)) assert.equal(new TextDecoder().decode(bytes), "x")
      assert.deepEqual(browser.clicked, [{ href: "blob:zip-output", download: "shrinkcord-discord.zip" }])
      await new Promise((resolve) => setTimeout(resolve, 5))
    } finally {
      browser.restore()
    }
  })

  it("reports fetch failures with a user-facing archive error", async (t) => {
    t.mock.method(globalThis, "fetch", async () => { throw new Error("network down") })

    await assert.rejects(downloadAll([video("one")]), (error: unknown) =>
      error instanceof DownloadAllError && error.code === "fetch",
    )
  })

  it("rejects unsuccessful HTTP responses", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("server error", { status: 503 }))

    await assert.rejects(downloadAll([video("one")]), (error: unknown) =>
      error instanceof DownloadAllError && error.code === "http" && /503/.test(error.message),
    )
  })

  it("enforces the total advertised input size before retaining over the cap", async (t) => {
    let calls = 0
    t.mock.method(globalThis, "fetch", async () => {
      calls += 1
      return new Response("x", {
        headers: { "content-length": String(MAX_DOWNLOAD_ALL_BYTES) },
      })
    })

    await assert.rejects(downloadAll([video("one"), video("two")]), (error: unknown) =>
      error instanceof DownloadAllError && error.code === "too-large",
    )
    assert.equal(calls, 2)
  })

  it("passes and honors an abort signal", async (t) => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined
      controller.abort()
      return new Response("x")
    })

    await assert.rejects(downloadAll([video("one")], { signal: controller.signal }), (error: unknown) =>
      error instanceof DownloadAllError && error.code === "aborted",
    )
    assert.equal(receivedSignal, controller.signal)
  })
})
