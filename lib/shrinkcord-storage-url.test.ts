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
  it("rounds remaining days down", () => {
    const now = new Date("2026-10-21T00:00:00.000Z")
    const label = formatStorageAvailabilityLabel("2026-10-27T12:00:00.000Z", now)
    assert.equal(label, "Available for 6 days")
  })

  it("shows one day when exactly one whole day remains", () => {
    const now = new Date("2026-10-21T12:00:00.000Z")
    const label = formatStorageAvailabilityLabel("2026-10-22T12:00:00.000Z", now)
    assert.equal(label, "Available for 1 day")
  })

  it("shows less than a day when under one whole day remains", () => {
    const now = new Date("2026-10-21T12:00:00.000Z")
    const label = formatStorageAvailabilityLabel("2026-10-21T22:00:00.000Z", now)
    assert.equal(label, "Available for less than a day")
  })
})
