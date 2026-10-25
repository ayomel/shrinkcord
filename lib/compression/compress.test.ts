import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { compressFile } from "./compress.ts"
import { DISCORD_FREE_LIMIT_BYTES } from "./limits.ts"

describe("compressFile input handling", () => {
  it("rejects an empty accepted image instead of marking it as passthrough", async () => {
    const file = new File([], "empty.png", { type: "image/png" })

    await assert.rejects(compressFile(file), /empty/i)
  })

  it("closes the bitmap when PNG transparency inspection fails", async () => {
    const originalCreateImageBitmap = globalThis.createImageBitmap
    let closed = false
    globalThis.createImageBitmap = async () => ({
      width: 1,
      height: 1,
      close: () => { closed = true },
    }) as ImageBitmap

    const file = {
      name: "large.png",
      type: "image/png",
      size: DISCORD_FREE_LIMIT_BYTES + 1,
      slice: () => ({ arrayBuffer: async () => { throw new Error("read failed") } }),
    } as unknown as File

    try {
      await assert.rejects(compressFile(file), /read failed/)
      assert.equal(closed, true)
    } finally {
      globalThis.createImageBitmap = originalCreateImageBitmap
    }
  })
})
