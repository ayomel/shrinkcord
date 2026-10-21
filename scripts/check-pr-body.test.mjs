import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { stripIgnoredRegions, validatePrBody } from "./check-pr-body.mjs"

describe("stripIgnoredRegions", () => {
  it("drops HTML comments, fenced code, and block HTML", () => {
    const body = [
      "<!-- hidden -->",
      "```js",
      "const x = ' - '",
      "```",
      "<div>footer “quote”</div>",
      "Visible text.",
    ].join("\n")
    const stripped = stripIgnoredRegions(body)
    assert.match(stripped, /Visible text\./)
    assert.doesNotMatch(stripped, /footer/)
    assert.doesNotMatch(stripped, /hidden/)
    assert.doesNotMatch(stripped, /const x/)
  })
})

describe("validatePrBody", () => {
  it("rejects an empty body", () => {
    const result = validatePrBody("   ")
    assert.equal(result.ok, false)
    assert.match(result.errors.join(" "), /empty/i)
  })

  it("rejects curly quotes and en dashes in prose", () => {
    const result = validatePrBody("- Summary with “curly” quotes.\n- Another line – bad dash.")
    assert.equal(result.ok, false)
  })

  it("rejects sentence dashes but allows list markers", () => {
    const bad = validatePrBody("- This item - broken dash.")
    assert.equal(bad.ok, false)
    const good = validatePrBody("- This item is a full sentence.")
    assert.equal(good.ok, true)
  })

  it("requires full-sentence bullets", () => {
    const result = validatePrBody("- lowercase start.")
    assert.equal(result.ok, false)
    const code = validatePrBody("- Run `pnpm test`.")
    assert.equal(code.ok, true)
  })

  it("ignores violations inside fenced code", () => {
    const result = validatePrBody(["- Valid bullet here.", "", "```", "foo – bar", "```"].join("\n"))
    assert.equal(result.ok, true)
  })
})
