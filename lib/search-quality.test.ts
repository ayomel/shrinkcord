import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { scaleForTarget, searchQualityBySize } from "./search-quality.ts"

describe("searchQualityBySize", () => {
  it("returns quality 1.0 immediately when the top encode already fits", async () => {
    const qualities: number[] = []
    const result = await searchQualityBySize(
      async (quality) => {
        qualities.push(quality)
        return { size: 10_000_000, quality }
      },
      20_000_000,
    )

    assert.equal(qualities.length, 1)
    assert.equal(qualities[0], 1)
    assert.ok(result.bestFit)
    assert.equal(result.bestFit.quality, 1)
    assert.equal(result.encodes, 1)
  })

  it("binary-searches toward the target and stays within ~2%", async () => {
    // Fake size curve: size ≈ 30MB * quality (monotonic).
    const target = 19_500_000
    const result = await searchQualityBySize(
      async (quality) => ({ size: Math.round(30_000_000 * quality), quality }),
      target,
    )

    assert.ok(result.bestFit)
    assert.ok(result.bestFit.size <= target)
    assert.ok(result.bestFit.size >= target * 0.98)
    assert.ok(result.encodes <= 1 + 8)
    assert.ok(result.bestFit.quality > 0.5)
    assert.ok(result.bestFit.quality < 1)
  })

  it("reports no fit when even min quality is too large", async () => {
    const result = await searchQualityBySize(
      async (quality) => ({ size: Math.round(40_000_000 * quality), quality }),
      19_500_000,
    )

    assert.equal(result.bestFit, null)
    assert.ok(result.smallest)
    assert.ok(result.smallest.size > 19_500_000)
    assert.ok(Math.abs(result.smallest.quality - 0.5) < 0.001)
  })

  it("respects a raised minQuality floor (transparent WebP path)", async () => {
    const qualities: number[] = []
    await searchQualityBySize(
      async (quality) => {
        qualities.push(quality)
        return { size: 80_000_000, quality }
      },
      19_500_000,
      { minQuality: 0.8 },
    )
    assert.ok(qualities.every((q) => q >= 0.8 - 1e-9))
  })
})

describe("scaleForTarget", () => {
  it("scales by sqrt(target/size) with a 0.97 margin", () => {
    const scale = scaleForTarget(19_500_000, 78_000_000)
    assert.ok(Math.abs(scale - Math.sqrt(19_500_000 / 78_000_000) * 0.97) < 1e-9)
  })
})
