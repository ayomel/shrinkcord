import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createShrinkcordUploadSession,
  putBlobWithXhr,
  uploadCompressedBlobToStorage,
  type ShrinkcordUploadSession,
} from "./shrinkcord-storage-upload.ts"

const baseUrl = "http://api.test"
const blob = new Blob([1, 2, 3], { type: "image/jpeg" })

function session(key: string): ShrinkcordUploadSession {
  return {
    key,
    upload_url: `https://storage.test/${key}`,
    method: "PUT",
    headers: {
      "Content-Type": "image/jpeg",
      "If-None-Match": "*",
    },
    download_url: `https://cdn.test/${key}`,
    expires_at: "2026-10-28T00:00:00.000Z",
  }
}

describe("createShrinkcordUploadSession", () => {
  it("POSTs filename, contentType, and size", async () => {
    let posted: string | undefined
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      posted = init?.body as string
      return new Response(JSON.stringify(session("a")), { status: 200 })
    }
    await createShrinkcordUploadSession(
      { filename: "photo-discord.jpg", contentType: "image/jpeg", size: 3 },
      { baseUrl, fetchImpl },
    )
    assert.deepEqual(JSON.parse(posted!), {
      filename: "photo-discord.jpg",
      contentType: "image/jpeg",
      size: 3,
    })
  })
})

describe("uploadCompressedBlobToStorage", () => {
  const originalEnv = process.env.NEXT_PUBLIC_SHRINKCORD_API_URL

  it("returns not_configured when the public API URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
    const result = await uploadCompressedBlobToStorage({
      blob,
      fileName: "a.jpg",
      contentType: "image/jpeg",
    })
    assert.deepEqual(result, { ok: false, reason: "not_configured" })
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = originalEnv
  })

  it("PUTs with session headers and reports progress", async () => {
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = baseUrl
    const progress: number[] = []
    const putHeaders: Record<string, string>[] = []
    const result = await uploadCompressedBlobToStorage({
      blob,
      fileName: "a.jpg",
      contentType: "image/jpeg",
      baseUrl,
      onProgress: (percent) => progress.push(percent),
      createSessionImpl: async () => session("key-1"),
      putImpl: async (_url, body, headers, _signal, onProgress) => {
        putHeaders.push(headers)
        onProgress?.(2, 4)
        onProgress?.(4, 4)
        assert.equal(body, blob)
        return 200
      },
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.downloadUrl, "https://cdn.test/key-1")
    }
    assert.deepEqual(putHeaders[0], {
      "Content-Type": "image/jpeg",
      "If-None-Match": "*",
    })
    assert.ok(progress.includes(100))
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = originalEnv
  })

  it("retries on 412 with a new upload session key", async () => {
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = baseUrl
    const keys: string[] = []
    const result = await uploadCompressedBlobToStorage({
      blob,
      fileName: "a.jpg",
      contentType: "image/jpeg",
      baseUrl,
      createSessionImpl: async () => {
        const next = keys.length === 0 ? "key-1" : "key-2"
        keys.push(next)
        return session(next)
      },
      putImpl: async () => (keys.length === 1 ? 412 : 200),
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.key, "key-2")
    assert.deepEqual(keys, ["key-1", "key-2"])
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = originalEnv
  })

  it("returns collision_exhausted after repeated 412 responses", async () => {
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = baseUrl
    const result = await uploadCompressedBlobToStorage({
      blob,
      fileName: "a.jpg",
      contentType: "image/jpeg",
      baseUrl,
      maxCollisionAttempts: 2,
      createSessionImpl: async () => session("dup"),
      putImpl: async () => 412,
    })
    assert.deepEqual(result, { ok: false, reason: "collision_exhausted" })
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = originalEnv
  })

  it("returns network on PUT failure without throwing", async () => {
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = baseUrl
    const result = await uploadCompressedBlobToStorage({
      blob,
      fileName: "a.jpg",
      contentType: "image/jpeg",
      baseUrl,
      createSessionImpl: async () => session("key-1"),
      putImpl: async () => {
        throw new Error("offline")
      },
    })
    assert.deepEqual(result, { ok: false, reason: "network" })
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = originalEnv
  })
})

describe("putBlobWithXhr", () => {
  it("is exported for direct unit testing via uploadCompressedBlobToStorage", () => {
    assert.equal(typeof putBlobWithXhr, "function")
  })
})
