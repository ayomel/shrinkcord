import assert from "node:assert/strict"
import { describe, it, mock } from "node:test"
import {
  getStorageLinkExpiryDelayMs,
  scheduleStorageLinkExpiryRefresh,
} from "./storageLinkExpiryRefresh.ts"

describe("getStorageLinkExpiryDelayMs", () => {
  it("returns null when the link is already expired or invalid", () => {
    const nowMs = Date.parse("2026-10-21T12:00:00.000Z")
    assert.equal(getStorageLinkExpiryDelayMs("2026-10-21T11:00:00.000Z", nowMs), null)
    assert.equal(getStorageLinkExpiryDelayMs("not-a-date", nowMs), null)
  })

  it("returns the milliseconds until expiry", () => {
    const nowMs = Date.parse("2026-10-21T12:00:00.000Z")
    const expiresAt = "2026-10-21T12:05:00.000Z"
    assert.equal(getStorageLinkExpiryDelayMs(expiresAt, nowMs), 5 * 60 * 1000)
  })
})

describe("scheduleStorageLinkExpiryRefresh", () => {
  it("fires once at expires_at and can be cleared before then", () => {
    const nowMs = Date.parse("2026-10-21T12:00:00.000Z")
    const expiresAt = "2026-10-21T12:00:30.000Z"
    const onExpiry = mock.fn()

    mock.timers.enable({ apis: ["setTimeout"], now: nowMs })

    const dispose = scheduleStorageLinkExpiryRefresh(expiresAt, onExpiry, nowMs)
    assert.equal(onExpiry.mock.callCount(), 0)

    mock.timers.tick(29_999)
    assert.equal(onExpiry.mock.callCount(), 0)

    mock.timers.tick(1)
    assert.equal(onExpiry.mock.callCount(), 1)

    mock.timers.tick(60_000)
    assert.equal(onExpiry.mock.callCount(), 1)

    dispose()
    mock.timers.reset()
  })

  it("does not schedule when expiry is already past", () => {
    const nowMs = Date.parse("2026-10-21T12:00:00.000Z")
    const onExpiry = mock.fn()
    mock.timers.enable({ apis: ["setTimeout"], now: nowMs })

    scheduleStorageLinkExpiryRefresh("2026-10-21T11:59:00.000Z", onExpiry, nowMs)
    mock.timers.tick(60_000)
    assert.equal(onExpiry.mock.callCount(), 0)

    mock.timers.reset()
  })
})
