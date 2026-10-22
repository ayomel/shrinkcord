import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { pngHeaderSuggestsAlpha } from "./pngAlpha.ts"

function crc32(buf: Uint8Array) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, data.length)
  const crcInput = new Uint8Array(typeBytes.length + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, typeBytes.length)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(crcInput))
  const out = new Uint8Array(4 + 4 + data.length + 4)
  out.set(len, 0)
  out.set(typeBytes, 4)
  out.set(data, 8)
  out.set(crc, 8 + data.length)
  return out
}

function pngWithColorType(colorType: number, extraChunks: Uint8Array[] = []) {
  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, 1) // width
  new DataView(ihdr.buffer).setUint32(4, 1) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const parts = [signature, chunk("IHDR", ihdr), ...extraChunks, chunk("IDAT", Uint8Array.of(0))]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe("pngHeaderSuggestsAlpha", () => {
  it("detects RGBA and gray+alpha color types", () => {
    assert.equal(pngHeaderSuggestsAlpha(pngWithColorType(6)), true)
    assert.equal(pngHeaderSuggestsAlpha(pngWithColorType(4)), true)
  })

  it("ignores opaque RGB and gray without tRNS", () => {
    assert.equal(pngHeaderSuggestsAlpha(pngWithColorType(2)), false)
    assert.equal(pngHeaderSuggestsAlpha(pngWithColorType(0)), false)
  })

  it("treats a tRNS chunk as possible alpha", () => {
    assert.equal(
      pngHeaderSuggestsAlpha(pngWithColorType(2, [chunk("tRNS", Uint8Array.of(0, 0, 0, 0, 0, 0))])),
      true,
    )
  })

  it("rejects non-PNG bytes", () => {
    assert.equal(pngHeaderSuggestsAlpha(Uint8Array.of(1, 2, 3, 4)), false)
  })
})
