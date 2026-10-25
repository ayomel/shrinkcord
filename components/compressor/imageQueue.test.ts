import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { classifyFileAsync } from "@/lib/fileClassification"
import { createQueueLifecycle } from "./queueLifecycle"
import { drainImages } from "./imageQueue"
import type { ImageQueueItem, QueueItem } from "./types"

function image(id: string, file: File): ImageQueueItem {
  return { kind: "image", id, file, status: "queued", progress: 0 }
}

const result = {
  blob: new Blob(["output"], { type: "image/png" }),
  fileName: "valid-discord.png",
  outputType: "image/png",
  convertedFromPng: false,
  flattenedTransparency: false,
  passthrough: true,
  scaled: false,
  missedTarget: false,
  originalBytes: 5,
  outputBytes: 6,
  width: 1,
  height: 1,
}

describe("image queue draining", () => {
  it("marks an unreadable file as an error and continues to the next image", async () => {
    const unreadable = new File(["broken"], "broken.png", { type: "image/png" })
    Object.defineProperty(unreadable, "slice", {
      configurable: true,
      value: () => ({ arrayBuffer: async () => { throw new Error("Could not read file.") } }),
    })
    const valid = new File(["image"], "valid.png", { type: "image/png" })
    const itemsRef = { current: [image("broken", unreadable), image("valid", valid)] as QueueItem[] }
    const imageRunning = { current: false }
    const imageStorageControllers = { current: new Map<string, AbortController>() }
    const urls = { current: [] as string[] }
    const lifecycle = createQueueLifecycle()
    const context = {
      itemsRef,
      imageRunning,
      imageStorageControllers,
      urls,
      lifecycle,
      update(id: string, patch: Partial<QueueItem>) {
        itemsRef.current = itemsRef.current.map((item) => item.id === id ? { ...item, ...patch } as QueueItem : item)
      },
    }
    const dependencies = {
      classifyFile: classifyFileAsync,
      runShrink: async () => result,
      isStorageEnabled: () => false,
      createObjectUrl: () => "blob:valid-output",
      revokeObjectUrl: () => {},
    }

    await drainImages(context, dependencies)

    assert.equal(itemsRef.current[0]?.status, "error")
    assert.match(itemsRef.current[0]?.error ?? "", /Could not read file/)
    assert.equal(itemsRef.current[1]?.status, "done")
    assert.equal(imageRunning.current, false)
    assert.deepEqual(urls.current, ["blob:valid-output"])
  })
})
