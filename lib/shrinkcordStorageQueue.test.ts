import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { enqueueStorageSaveByFileName, resetStorageSaveQueuesForTests } from "./shrinkcordStorageQueue.ts"
import { uploadCompressedBlobToStorage, type ShrinkcordUploadSession } from "./shrinkcordStorageUpload.ts"

const baseUrl = "http://api.test"
const fileName = "slowlink-discord.png"
const blob = new Blob([1, 2, 3], { type: "image/png" })

function session(key: string): ShrinkcordUploadSession {
  return {
    key,
    upload_url: `https://storage.test/${key}`,
    method: "PUT",
    headers: { "Content-Type": "image/png", "If-None-Match": "*" },
    download_url: `https://cdn.test/${key}`,
    expires_at: "2026-10-28T00:00:00.000Z",
  }
}

describe("enqueueStorageSaveByFileName", () => {
  it("serializes ten same-name saves so each gets a distinct key", async () => {
    resetStorageSaveQueuesForTests()
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = baseUrl

    let activePuts = 0
    let maxActivePuts = 0
    let seq = 0
    const keys: string[] = []

    const uploads = Array.from({ length: 10 }, () =>
      enqueueStorageSaveByFileName(fileName, () =>
        uploadCompressedBlobToStorage({
          blob,
          fileName,
          contentType: "image/png",
          baseUrl,
          createSessionImpl: async () => {
            seq += 1
            const key = `key-${seq}`
            keys.push(key)
            return session(key)
          },
          putImpl: async () => {
            activePuts += 1
            maxActivePuts = Math.max(maxActivePuts, activePuts)
            await new Promise((resolve) => setTimeout(resolve, 15))
            activePuts -= 1
            return 200
          },
        }),
      ),
    )

    const results = await Promise.all(uploads)
    assert.equal(results.length, 10)
    assert.ok(results.every((result) => result.ok))
    assert.equal(new Set(keys).size, 10)
    assert.equal(maxActivePuts, 1)

    delete process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
    resetStorageSaveQueuesForTests()
  })
})
