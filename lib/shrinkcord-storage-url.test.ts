import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  formatStorageAvailabilityLabel,
  isStorageLinkExpired,
  resolveShrinkcordStorageUrl,
} from "./shrinkcord-storage-url.ts"

const MS_PER_DAY = 24 * 60 * 60 * 1000

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
  const now = new Date("2026-10-21T00:00:00.000Z")

  it("rounds remaining days up to whole days", () => {
    const exactlySevenDays = new Date(now.getTime() + 7 * MS_PER_DAY)
    assert.equal(formatStorageAvailabilityLabel(exactlySevenDays.toISOString(), now), "Available for 7 days")

    const almostSevenDays = new Date(now.getTime() + 7 * MS_PER_DAY - 5_000)
    assert.equal(formatStorageAvailabilityLabel(almostSevenDays.toISOString(), now), "Available for 7 days")

    const sixAndHalfDays = new Date(now.getTime() + 6.5 * MS_PER_DAY)
    assert.equal(formatStorageAvailabilityLabel(sixAndHalfDays.toISOString(), now), "Available for 7 days")
  })

  it("never shows more than the seven-day retention cap", () => {
    const sevenDaysPlusOneMs = new Date(now.getTime() + 7 * MS_PER_DAY + 1)
    assert.equal(formatStorageAvailabilityLabel(sevenDaysPlusOneMs.toISOString(), now), "Available for 7 days")

    const sevenDaysPlusFiveSeconds = new Date(now.getTime() + 7 * MS_PER_DAY + 5_000)
    assert.equal(formatStorageAvailabilityLabel(sevenDaysPlusFiveSeconds.toISOString(), now), "Available for 7 days")

    const sevenDaysPlusOneHour = new Date(now.getTime() + 7 * MS_PER_DAY + MS_PER_DAY / 24)
    assert.equal(formatStorageAvailabilityLabel(sevenDaysPlusOneHour.toISOString(), now), "Available for 7 days")
  })

  it("shows two days when a little over one day remains", () => {
    const onePointTwoDays = new Date(now.getTime() + 1.2 * MS_PER_DAY)
    assert.equal(formatStorageAvailabilityLabel(onePointTwoDays.toISOString(), now), "Available for 2 days")
  })

  it("shows one day when exactly one whole day remains", () => {
    const label = formatStorageAvailabilityLabel("2026-10-22T00:00:00.000Z", now)
    assert.equal(label, "Available for 1 day")
  })

  it("shows less than a day when under 24 hours remain", () => {
    const halfDay = new Date(now.getTime() + 0.5 * MS_PER_DAY)
    assert.equal(formatStorageAvailabilityLabel(halfDay.toISOString(), now), "Available for less than a day")

    const tenHours = new Date("2026-10-21T12:00:00.000Z")
    assert.equal(
      formatStorageAvailabilityLabel("2026-10-21T22:00:00.000Z", tenHours),
      "Available for less than a day",
    )
  })

  it("shows link expired when the expiry time has passed", () => {
    assert.equal(formatStorageAvailabilityLabel("2026-10-20T23:59:59.000Z", now), "Link expired")
  })
})

describe("isStorageLinkExpired", () => {
  it("is true when expires_at is in the past", () => {
    const now = new Date("2026-10-21T00:00:00.000Z")
    assert.equal(isStorageLinkExpired("2026-10-20T00:00:00.000Z", now), true)
  })

  it("is false when expires_at is still in the future", () => {
    const now = new Date("2026-10-21T00:00:00.000Z")
    assert.equal(isStorageLinkExpired("2026-10-22T00:00:00.000Z", now), false)
  })
})
