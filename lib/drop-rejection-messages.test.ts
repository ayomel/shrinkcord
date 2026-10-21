import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatDropClassifyErrors } from "./drop-rejection-messages.ts"

describe("formatDropClassifyErrors", () => {
  it("uses wrong-type copy for unsupported files when the video API is on", () => {
    const message = formatDropClassifyErrors([{ kind: "wrong-type", fileName: "notes.txt" }], true)
    assert.ok(message)
    assert.match(message, /notes\.txt/)
    assert.match(message, /JPEG, PNG, WebP, MP4, or MOV/)
    assert.doesNotMatch(message, /unavailable/i)
  })

  it("uses video-unavailable copy for MP4 when the video API is off", () => {
    const message = formatDropClassifyErrors(
      [{ kind: "video-unavailable", fileName: "clip.mp4" }],
      false,
    )
    assert.ok(message)
    assert.match(message, /clip\.mp4/)
    assert.match(message, /Video upload is unavailable/)
    assert.doesNotMatch(message, /Choose a/)
  })

  it("lists only image types for unsupported files when the video API is off", () => {
    const message = formatDropClassifyErrors([{ kind: "wrong-type", fileName: "notes.txt" }], false)
    assert.ok(message)
    assert.match(message, /JPEG, PNG, or WebP/)
    assert.doesNotMatch(message, /MP4/)
    assert.doesNotMatch(message, /MOV/)
    assert.doesNotMatch(message, /unavailable/i)
  })

  it("shows both messages for a mixed drop when each rejection applies", () => {
    const message = formatDropClassifyErrors(
      [
        { kind: "wrong-type", fileName: "notes.txt" },
        { kind: "video-unavailable", fileName: "clip.mp4" },
      ],
      false,
    )
    assert.ok(message)
    assert.match(message, /notes\.txt.*JPEG, PNG, or WebP/)
    assert.match(message, /clip\.mp4.*Video upload is unavailable/)
  })
})
