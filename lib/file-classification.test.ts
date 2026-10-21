import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  classifyByMagicBytes,
  classifyByMimeAndName,
  classifyFile,
} from "./file-classification.ts"

describe("classifyByMimeAndName", () => {
  it("recognizes images and videos from MIME and extension", () => {
    assert.equal(classifyByMimeAndName({ name: "a.jpg", type: "image/jpeg" }), "image")
    assert.equal(classifyByMimeAndName({ name: "a.png", type: "" }), "image")
    assert.equal(classifyByMimeAndName({ name: "a.mp4", type: "video/mp4" }), "video")
    assert.equal(classifyByMimeAndName({ name: "iphone.MOV", type: "" }), "video")
    assert.equal(classifyByMimeAndName({ name: "doc.pdf", type: "application/pdf" }), "unsupported")
  })
})

describe("classifyByMagicBytes", () => {
  it("detects JPEG, PNG, WebP, and ISO BMFF video", () => {
    assert.equal(classifyByMagicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0x00])), "image")
    assert.equal(
      classifyByMagicBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      "image",
    )
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    assert.equal(classifyByMagicBytes(webp), "image")
    const mp4 = new Uint8Array(12)
    mp4.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    assert.equal(classifyByMagicBytes(mp4), "video")
    assert.equal(classifyByMagicBytes(new Uint8Array([0, 1, 2])), "unsupported")
  })
})

describe("classifyFile", () => {
  it("falls back to magic bytes when MIME and extension are ambiguous", () => {
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    assert.deepEqual(classifyFile({ name: "unknown", type: "" }, head), { kind: "image", mime: null })
  })
})
