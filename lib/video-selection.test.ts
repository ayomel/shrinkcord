import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DEFAULT_VIDEO_TARGET_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_TARGET_MB,
  parseVideoTarget,
  validateVideoFile,
} from "./video-selection.ts"

describe("validateVideoFile", () => {
  it("accepts MP4 MIME types and empty MIME with an MP4 filename", () => {
    assert.equal(validateVideoFile({ name: "clip.mp4", type: "video/mp4", size: 1 }), null)
    assert.equal(validateVideoFile({ name: "clip.MP4", type: "", size: 1 }), null)
  })

  it("accepts iPhone MOV files", () => {
    assert.equal(validateVideoFile({ name: "iphone.mov", type: "video/quicktime", size: 1 }), null)
  })

  it("rejects empty files, unsupported types, and files over 500 MiB", () => {
    assert.match(validateVideoFile({ name: "clip.mp4", type: "video/mp4", size: 0 }) ?? "", /empty/i)
    assert.match(validateVideoFile({ name: "clip.avi", type: "video/x-msvideo", size: 1 }) ?? "", /MP4 or/i)
    assert.match(validateVideoFile({ name: "clip.mp4", type: "video/mp4", size: MAX_VIDEO_BYTES + 1 }) ?? "", /524\.288 MB.*500 MiB/i)
  })
})

describe("parseVideoTarget", () => {
  it("defaults to 20 decimal MB", () => {
    assert.equal(DEFAULT_VIDEO_TARGET_BYTES, 20_000_000)
    assert.equal(parseVideoTarget("20").bytes, 20_000_000)
  })

  it("converts six decimal places to exact bytes", () => {
    assert.equal(parseVideoTarget("0.000001").bytes, 1)
  })

  it("accepts the 500 MiB limit expressed in decimal MB", () => {
    assert.equal(MAX_VIDEO_TARGET_MB, 524.288)
    assert.equal(parseVideoTarget("524.288").bytes, MAX_VIDEO_BYTES)
  })

  it("rejects values beyond the file limit", () => {
    assert.match(parseVideoTarget("524.288001").error ?? "", /524\.288 MB/i)
  })

  it("rejects empty, nonnumeric, nonfinite, and nonpositive values", () => {
    for (const value of ["", "   ", "abc", "Infinity", "NaN", "0", "-1", "0.0000006"]) {
      assert.ok(parseVideoTarget(value).error, `Expected ${JSON.stringify(value)} to be rejected`)
    }
  })
})
