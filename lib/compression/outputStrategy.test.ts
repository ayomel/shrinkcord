import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { MIN_TRANSPARENT_WEBP_QUALITY } from "./limits.ts"
import { preferTransparentWebp } from "./outputStrategy.ts"
import { searchQualityBySize } from "./searchQuality.ts"

describe("preferTransparentWebp", () => {
  it("keeps a WebP that already fits the budget", () => {
    assert.equal(
      preferTransparentWebp({
        candidate: { size: 10_000_000 },
        missedTarget: false,
      }),
      true,
    )
  })

  it("falls back to flattened JPEG when WebP still misses after scale passes", () => {
    assert.equal(
      preferTransparentWebp({
        candidate: { size: 40_000_000 },
        missedTarget: true,
      }),
      false,
    )
    assert.equal(
      preferTransparentWebp({
        candidate: null,
        missedTarget: true,
      }),
      false,
    )
  })
})

describe("transparent PNG WebP quality floor", () => {
  it(`never samples below MIN_TRANSPARENT_WEBP_QUALITY (${MIN_TRANSPARENT_WEBP_QUALITY})`, async () => {
    const qualities: number[] = []
    const target = 19_500_000
    // Always over target so the search walks down to the floor.
    await searchQualityBySize(
      async (quality) => {
        qualities.push(quality)
        return { size: Math.round(50_000_000 * quality), quality }
      },
      target,
      { minQuality: MIN_TRANSPARENT_WEBP_QUALITY },
    )

    assert.ok(qualities.length >= 2)
    assert.ok(qualities.every((q) => q >= MIN_TRANSPARENT_WEBP_QUALITY - 1e-9))
    assert.ok(Math.min(...qualities) <= MIN_TRANSPARENT_WEBP_QUALITY + 0.001)
  })
})
