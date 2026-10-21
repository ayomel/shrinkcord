import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeCompressProgress, videoProgressSnapshot } from "./video-progress.ts"

describe("normalizeCompressProgress", () => {
  it("caps in-flight encoding below 100 until completed", () => {
    assert.equal(normalizeCompressProgress("PROCESSING", 100), 99)
    assert.equal(normalizeCompressProgress("COMPLETED", 40), 100)
    assert.equal(normalizeCompressProgress("FAILED", 55), 55)
  })
})

describe("videoProgressSnapshot", () => {
  it("never reports 100% display until completed", () => {
    const uploading = videoProgressSnapshot({ phase: "uploading", uploadPercent: 100, compressPercent: 0 })
    assert.equal(uploading.displayPercent, 99)
    const compressing = videoProgressSnapshot({
      phase: "compressing",
      uploadPercent: 100,
      compressPercent: 100,
    })
    assert.equal(compressing.displayPercent, 99)
    const done = videoProgressSnapshot({
      phase: "completed",
      uploadPercent: 100,
      compressPercent: 100,
      completed: true,
    })
    assert.equal(done.displayPercent, 100)
  })
})
