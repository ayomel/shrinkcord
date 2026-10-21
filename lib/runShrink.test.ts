import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ShrinkResult } from "./compress.ts"
import { runShrink } from "./runShrink.ts"

function fakeResult(overrides: Partial<ShrinkResult> = {}): ShrinkResult {
  return {
    blob: new Blob(["x"], { type: "image/jpeg" }),
    fileName: "photo-discord.jpg",
    outputType: "image/jpeg",
    convertedFromPng: true,
    flattenedTransparency: true,
    passthrough: false,
    scaled: false,
    missedTarget: false,
    originalBytes: 30_000_000,
    outputBytes: 10_000_000,
    width: 100,
    height: 100,
    ...overrides,
  }
}

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  constructor(private readonly mode: "error-message" | "onerror") {}

  postMessage(_data?: unknown) {
    void _data
    queueMicrotask(() => {
      if (this.mode === "error-message") {
        this.onmessage?.({
          data: { type: "error", message: "worker boom" },
        } as MessageEvent)
      } else {
        this.onerror?.({ message: "worker crash" } as ErrorEvent)
      }
    })
  }

  terminate() {
    this.terminated = true
  }
}

describe("runShrink main-thread fallback", () => {
  it("uses compress when openWorker throws", async () => {
    const file = new File(["png"], "x.png", { type: "image/png" })
    const mainThread = fakeResult({ fileName: "main-thread.jpg" })
    let compressCalls = 0

    const result = await runShrink(file, undefined, {
      openWorker: () => {
        throw new Error("Worker unavailable")
      },
      compress: async () => {
        compressCalls += 1
        return mainThread
      },
    })

    assert.equal(compressCalls, 1)
    assert.equal(result.fileName, "main-thread.jpg")
  })

  it("falls back to compress when the worker posts an error", async () => {
    const file = new File(["png"], "x.png", { type: "image/png" })
    const mainThread = fakeResult({
      flattenedTransparency: true,
      fileName: "fallback-flat.jpg",
    })
    let compressCalls = 0
    const worker = new FakeWorker("error-message")

    const result = await runShrink(file, undefined, {
      openWorker: () => worker as unknown as Worker,
      compress: async () => {
        compressCalls += 1
        return mainThread
      },
    })

    assert.equal(compressCalls, 1)
    assert.equal(result.fileName, "fallback-flat.jpg")
    assert.equal(result.flattenedTransparency, true)
    assert.equal(worker.terminated, true)
  })

  it("falls back to compress when the worker fires onerror", async () => {
    const file = new File(["png"], "x.png", { type: "image/png" })
    const mainThread = fakeResult({ fileName: "onerror-fallback.jpg" })
    let compressCalls = 0
    const worker = new FakeWorker("onerror")

    const result = await runShrink(file, undefined, {
      openWorker: () => worker as unknown as Worker,
      compress: async () => {
        compressCalls += 1
        return mainThread
      },
    })

    assert.equal(compressCalls, 1)
    assert.equal(result.fileName, "onerror-fallback.jpg")
    assert.equal(worker.terminated, true)
  })
})
