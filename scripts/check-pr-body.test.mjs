import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeLineEndings, stripIgnoredRegions, validatePrBody } from "./check-pr-body.mjs"

describe("normalizeLineEndings", () => {
  it("normalizes CRLF so bullet lines are matched", () => {
    const body = "- Bad bullet missing terminal punctuation\r\n- Good sentence here."
    const result = validatePrBody(body)
    assert.equal(result.ok, false)
    assert.match(result.errors.join(" "), /Bullet items must end/)
  })
})

describe("stripIgnoredRegions", () => {
  it("drops HTML comments, fenced code, tilde fences, indented code, and block HTML", () => {
    const body = [
      "<!-- hidden -->",
      "~~~",
      "const x = ' - '",
      "~~~",
      "    indented code",
      "```js",
      "more code",
      "```",
      "<div>footer “quote”</div>",
      "Visible text.",
    ].join("\n")
    const stripped = stripIgnoredRegions(body)
    assert.match(stripped, /Visible text\./)
    assert.doesNotMatch(stripped, /footer/)
    assert.doesNotMatch(stripped, /hidden/)
    assert.doesNotMatch(stripped, /const x/)
    assert.doesNotMatch(stripped, /indented/)
    assert.doesNotMatch(stripped, /more code/)
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

  it("allows bullets that start with inline code", () => {
    const result = validatePrBody("- `QUEUED` is shown as a separate state.")
    assert.equal(result.ok, true)
  })

  it("allows bullets that end with a markdown link parenthesis", () => {
    const result = validatePrBody("- See [the docs](https://example.com)")
    assert.equal(result.ok, true)
  })

  it("allows bullets that end with a parenthetical before the period", () => {
    const result = validatePrBody("- Fixed regression (see #21).")
    assert.equal(result.ok, true)
  })

  it("allows bullets that end with a question mark", () => {
    const result = validatePrBody("- Should we ship this change?")
    assert.equal(result.ok, true)
  })

  it("allows GitHub task-list bullets", () => {
    const result = validatePrBody("- [x] Ran `pnpm test` locally.")
    assert.equal(result.ok, true)
  })

  it("allows bullets that start with bold or a link", () => {
    assert.equal(validatePrBody("- **Note:** This updates copy only.").ok, true)
    assert.equal(
      validatePrBody("- [Issue #21](https://github.com/example/repo/issues/21) tracks follow-up.").ok,
      true,
    )
  })

  it("ignores violations inside fenced and indented code", () => {
    const result = validatePrBody(
      [
        "- Valid bullet here.",
        "",
        "    foo – bar",
        "~~~",
        "foo – bar",
        "~~~",
      ].join("\n"),
    )
    assert.equal(result.ok, true)
  })

  it("exports normalizeLineEndings for CRLF input", () => {
    assert.equal(normalizeLineEndings("a\r\nb\rc"), "a\nb\nc")
  })
})
