import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildStorageResultPresentation, STORAGE_NOT_SAVED_NOTE } from "./storage-result-copy.ts"
import {
  createShrinkcordUploadSession,
  putBlobWithXhr,
  putUploadTimeoutMs,
  StorageTimeoutError,
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
  it("POSTs snake_case filename, content_type, and size", async () => {
    let posted: string | undefined
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      posted = init?.body as string
      return new Response(JSON.stringify(session("a")), { status: 201 })
    }
    await createShrinkcordUploadSession(
      { filename: "photo-discord.jpg", content_type: "image/jpeg", size: 3 },
      { baseUrl, fetchImpl },
    )
    assert.deepEqual(JSON.parse(posted!), {
      filename: "photo-discord.jpg",
      content_type: "image/jpeg",
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

  it("retries on 412 with previous_key from the failed key", async () => {
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = baseUrl
    const postedBodies: Array<Record<string, unknown>> = []
    const result = await uploadCompressedBlobToStorage({
      blob,
      fileName: "a.jpg",
      contentType: "image/jpeg",
      baseUrl,
      createSessionImpl: async (input) => {
        postedBodies.push({ ...input })
        const key = postedBodies.length === 1 ? "key-1" : "key-2"
        return session(key)
      },
      putImpl: async () => (postedBodies.length === 1 ? 412 : 200),
    })
    assert.equal(result.ok, true)
    assert.equal(postedBodies[1]?.previous_key, "key-1")
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

  it("hung POST ends in not saved online", async () => {
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = baseUrl
    const result = await uploadCompressedBlobToStorage({
      blob,
      fileName: "a.jpg",
      contentType: "image/jpeg",
      baseUrl,
      createSessionImpl: async () => {
        throw new StorageTimeoutError()
      },
    })
    assert.deepEqual(result, { ok: false, reason: "network" })
    const view = buildStorageResultPresentation({ storageNotSaved: true })
    assert.equal(view?.kind, "not_saved")
    if (view?.kind === "not_saved") assert.equal(view.note, STORAGE_NOT_SAVED_NOTE)
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = originalEnv
  })

  it("hung PUT ends in not saved online", async () => {
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = baseUrl
    const result = await uploadCompressedBlobToStorage({
      blob,
      fileName: "a.jpg",
      contentType: "image/jpeg",
      baseUrl,
      createSessionImpl: async () => session("key-1"),
      putImpl: async () => {
        throw new StorageTimeoutError()
      },
    })
    assert.deepEqual(result, { ok: false, reason: "network" })
    const view = buildStorageResultPresentation({ storageNotSaved: true })
    assert.equal(view?.kind, "not_saved")
    if (view?.kind === "not_saved") assert.equal(view.note, STORAGE_NOT_SAVED_NOTE)
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

describe("putUploadTimeoutMs", () => {
  const maxTimeout = 30 * 60 * 1000

  it("adds time per MiB so sub-megabyte files stay under the cap", () => {
    assert.ok(putUploadTimeoutMs(900 * 1024) < maxTimeout)
    assert.equal(putUploadTimeoutMs(900 * 1024), 60_000)
    assert.ok(putUploadTimeoutMs(25 * 1024 * 1024) < putUploadTimeoutMs(30 * 1024 * 1024))
  })
})

describe("putBlobWithXhr", () => {
  it("is exported for direct unit testing via uploadCompressedBlobToStorage", () => {
    assert.equal(typeof putBlobWithXhr, "function")
  })
})
