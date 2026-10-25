import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"

import { CompressorQueueRow } from "./CompressorQueueRow"
import type { ImageQueueItem, QueueItem, VideoQueueItem } from "./types"

const video: VideoQueueItem = {
  kind: "video",
  id: "video-1",
  file: new File(["video"], "clip.mov", { type: "video/quicktime" }),
  status: "queued",
  uploadProgress: 0,
  compressProgress: 0,
  downloadProgress: 0,
}

function renderRow(item: QueueItem) {
  return renderToStaticMarkup(
    <CompressorQueueRow
      item={item}
      onDownload={() => {}}
      onRetry={() => {}}
      onCancel={() => {}}
      onRemove={() => {}}
    />,
  )
}

describe("CompressorQueueRow", () => {
  it("offers exactly one retry for a retryable video error", () => {
    const html = renderRow({ ...video, status: "error", error: "Server busy.", canRetry: true })
    assert.equal((html.match(/>Retry<\/button>/g) ?? []).length, 1)
    assert.match(html, /role="alert"/)
    assert.match(html, /Server busy\./)
    assert.doesNotMatch(html, />Cancel<\/button>/)
    assert.match(html, /aria-label="Remove clip.mov"/)
  })

  it("does not offer retry for a permanent video error", () => {
    const html = renderRow({ ...video, status: "error", error: "Unsupported video.", canRetry: false })
    assert.doesNotMatch(html, />Retry<\/button>/)
  })

  for (const [status, label, progress] of [
    ["uploading", "Video upload progress", "Uploading 37 percent"],
    ["processing", "Video compression progress", "Compressing 37 percent"],
    ["downloading", "Video download progress", "Downloading 37 percent"],
  ] as const) {
    it(`keeps cancellation and accessible progress while ${status}`, () => {
      const html = renderRow({
        ...video,
        status,
        uploadProgress: 37,
        compressProgress: 37,
        downloadProgress: 37,
      })
      assert.match(html, />Cancel<\/button>/)
      assert.ok(html.includes(`aria-label="${label}"`))
      assert.ok(html.includes(progress))
      assert.doesNotMatch(html, />Download<\/button>/)
    })
  }

  it("keeps both responsive download controls on a completed video", () => {
    const html = renderRow({ ...video, status: "done", outputBytes: 3, downloadUrl: "blob:output" })
    assert.equal((html.match(/>Download<\/button>/g) ?? []).length, 2)
    assert.match(html, /Ready/)
    assert.doesNotMatch(html, />Cancel<\/button>/)
  })

  it("shows canceled and checking videos without active actions", () => {
    for (const status of ["canceled", "precheck"] as const) {
      const html = renderRow({ ...video, status })
      assert.match(html, status === "canceled" ? /Canceled/ : /Checking/)
      assert.doesNotMatch(html, />(Cancel|Retry|Download)<\/button>/)
    }
  })

  it("preserves the unchanged-image result and local download controls", () => {
    const image: ImageQueueItem = {
      kind: "image",
      id: "image-1",
      file: new File(["image"], "small.png", { type: "image/png" }),
      status: "done",
      progress: 100,
      downloadUrl: "blob:image-output",
      storagePassthrough: true,
      result: {
        blob: new Blob(["image"], { type: "image/png" }),
        fileName: "small-discord.png",
        outputType: "image/png",
        convertedFromPng: false,
        flattenedTransparency: false,
        passthrough: true,
        scaled: false,
        missedTarget: false,
        originalBytes: 5,
        outputBytes: 5,
        width: 1,
        height: 1,
      },
    }
    const html = renderRow(image)
    assert.match(html, /Already fits, unchanged/)
    assert.match(html, /Already fits, not saved online/)
    assert.equal((html.match(/>Download<\/button>/g) ?? []).length, 2)
    assert.match(html, /aria-label="Remove small.png"/)
  })
})
