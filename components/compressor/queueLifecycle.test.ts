import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { classifyQueueFiles, commitQueueItems, createQueueLifecycle } from "./queueLifecycle"
import type { QueueItem } from "./types"

const video: QueueItem = {
  kind: "video",
  id: "video-1",
  file: new File(["video"], "clip.mov", { type: "video/quicktime" }),
  status: "precheck",
  uploadProgress: 0,
  compressProgress: 0,
  downloadProgress: 0,
}
const secondVideo = { ...video, id: "video-2" }

describe("compressor queue lifecycle", () => {
  it("publishes every row before starting work for newly classified files", () => {
    const itemsRef = { current: [] as QueueItem[] }
    const snapshots: QueueItem[][] = []

    commitQueueItems(itemsRef, (items) => snapshots.push(items), [video, secondVideo], () => {
      assert.deepEqual(itemsRef.current.map((item) => item.id), ["video-1", "video-2"])
      assert.deepEqual(snapshots[0]?.map((item) => item.id), ["video-1", "video-2"])
    })

    assert.deepEqual(itemsRef.current.map((item) => item.status), ["precheck", "precheck"])
  })

  it("invalidates async work captured before clear and unmount", () => {
    const lifecycle = createQueueLifecycle()
    const beforeClear = lifecycle.capture()

    lifecycle.invalidate()
    assert.equal(lifecycle.isCurrent(beforeClear), false)

    const beforeUnmount = lifecycle.capture()
    lifecycle.dispose()
    assert.equal(lifecycle.isCurrent(beforeUnmount), false)
    assert.equal(lifecycle.isAlive(), false)

    lifecycle.activate()
    assert.equal(lifecycle.isCurrent(beforeUnmount), false)
    assert.equal(lifecycle.isAlive(), true)
    assert.equal(lifecycle.isCurrent(lifecycle.capture()), true)
  })

  it("ignores a late completion after clear while allowing work enqueued afterward", () => {
    const lifecycle = createQueueLifecycle()
    const beforeClear = lifecycle.capture()
    let acceptedCompletion = false

    lifecycle.invalidate()
    if (lifecycle.isCurrent(beforeClear)) acceptedCompletion = true

    assert.equal(acceptedCompletion, false)
    assert.equal(lifecycle.isCurrent(lifecycle.capture()), true)
  })

  it("continues classifying later files when one file read rejects", async () => {
    const files = ["unreadable.mov", "valid.png"]
    const { results, failed } = await classifyQueueFiles(
      files,
      async (file) => {
        if (file === "unreadable.mov") throw new Error("File read failed.")
        return "image"
      },
      () => true,
    )

    assert.deepEqual(failed, ["unreadable.mov"])
    assert.deepEqual(results, [{ file: "valid.png", classification: "image" }])
  })

  it("discards a classification promise that completes after clear", async () => {
    const lifecycle = createQueueLifecycle()
    const generation = lifecycle.capture()
    let finishClassification!: (value: string) => void
    const classification = classifyQueueFiles(
      ["slow.png"],
      () => new Promise<string>((resolve) => { finishClassification = resolve }),
      () => lifecycle.isCurrent(generation),
    )

    lifecycle.invalidate()
    finishClassification("image")

    assert.deepEqual(await classification, { results: [], failed: [] })
  })
})
