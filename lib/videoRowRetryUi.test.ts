import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { videoRetryButtonCount, videoRetryUiFlags } from "./videoRowRetryUi.ts"

describe("videoRetryUiFlags", () => {
  it("renders exactly one Retry affordance on a failed video row", () => {
    const item = {
      kind: "video" as const,
      status: "error",
      canRetry: true,
      error: "Server busy. Try again.",
    }
    const flags = videoRetryUiFlags(item)
    assert.equal(flags.toolbar, false)
    assert.equal(flags.errorPanel, true)
    assert.equal(videoRetryButtonCount(item), 1)
  })

  it("does not show Retry on rows that are not retryable", () => {
    const item = {
      kind: "video" as const,
      status: "error",
      canRetry: false,
      error: "Canceled.",
    }
    assert.equal(videoRetryButtonCount(item), 0)
  })
})
