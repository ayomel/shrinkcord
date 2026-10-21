import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatStorageAvailabilityLabel, resolveShrinkcordStorageUrl } from "./shrinkcord-storage-url.ts"

describe("resolveShrinkcordStorageUrl", () => {
  it("keeps absolute URLs unchanged", () => {
    const url = "https://cdn.test/file.jpg?sig=abc"
    assert.equal(resolveShrinkcordStorageUrl(url, "https://api.test"), url)
  })

  it("resolves relative paths against the API base", () => {
    assert.equal(
      resolveShrinkcordStorageUrl("/objects/abc", "https://api.test"),
      "https://api.test/objects/abc",
    )
  })
})

describe("formatStorageAvailabilityLabel", () => {
  it("uses whole-day rounding when several days remain", () => {
    const now = new Date("2026-10-21T12:00:00.000Z")
    const label = formatStorageAvailabilityLabel("2026-10-28T12:00:00.000Z", now)
    assert.equal(label, "Available for 7 days")
  })

  it("falls back to a calendar date when less than one whole day remains", () => {
    const now = new Date("2026-10-21T12:00:00.000Z")
    const label = formatStorageAvailabilityLabel("2026-10-21T22:00:00.000Z", now)
    assert.match(label, /Available until/)
  })
})
