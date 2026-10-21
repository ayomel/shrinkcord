#!/usr/bin/env node

const CURLY_APOSTROPHE = /[\u2018\u2019]/u
const CURLY_QUOTE = /[\u201C\u201D]/u
const EN_EM_DASH = /[\u2013\u2014]/u

/** List marker plus optional GitHub task checkbox. */
const BULLET_LINE = /^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$/

/**
 * @param {string} body
 * @returns {string}
 */
export function normalizeLineEndings(body) {
  return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "")
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripFencedCodeBlocks(text) {
  let out = text.replace(/```[\s\S]*?```/g, "")
  out = out.replace(/~~~[\s\S]*?~~~/g, "")
  return out
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripIndentedCodeBlocks(text) {
  const lines = text.split("\n")
  const out = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!/^(?: {4}|\t)/.test(line)) {
      out.push(line)
      index += 1
      continue
    }

    const previous = out.length > 0 ? out[out.length - 1] : ""
    const followsBlankLine = out.length === 0 || previous.trim() === ""
    const dedented = line.replace(/^(?: {4}|\t)+/, "")
    const isNestedListItem = /^(?:[-*+]|\d+\.)\s/.test(dedented)

    if (!followsBlankLine || isNestedListItem) {
      out.push(line)
      index += 1
      continue
    }

    while (index < lines.length && /^(?: {4}|\t)/.test(lines[index])) {
      index += 1
    }
  }
  return out.join("\n")
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripHtmlBlocks(text) {
  let out = text
  const blockTags = ["div", "table", "section", "footer", "header", "nav", "span"]
  let previous = ""
  while (out !== previous) {
    previous = out
    for (const tag of blockTags) {
      out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "")
    }
    out = out.replace(/<[^>]+>/g, "")
  }
  return out
}

/**
 * Shared removal of non-prose regions (keeps inline code when stripInlineCode is false).
 * @param {string} body
 * @param {{ stripInlineCode: boolean }} options
 * @returns {string}
 */
function stripIgnoredRegionsWithOptions(body, { stripInlineCode }) {
  let text = normalizeLineEndings(body)
  text = stripHtmlComments(text)
  text = stripFencedCodeBlocks(text)
  text = stripIndentedCodeBlocks(text)
  text = stripHtmlBlocks(text)
  if (stripInlineCode) {
    text = text.replace(/`[^`\n]*`/g, "")
  }
  return text
}

/**
 * Remove regions that should not be linted for typography (comments, code, HTML blocks).
 * @param {string} body
 * @returns {string}
 */
export function stripIgnoredRegions(body) {
  return stripIgnoredRegionsWithOptions(body, { stripInlineCode: true })
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function asciiDashViolationsInLine(line) {
  const listMatch = line.match(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.*)$/)
  const prose = listMatch ? listMatch[1] : line
  const errors = []
  if (/ - /.test(prose)) errors.push("Use a hyphen only for list markers, not ' - ' inside a sentence.")
  if (/ -- /.test(prose)) errors.push("Do not use ' -- ' as a dash inside a sentence.")
  return errors
}

/**
 * @param {string} bulletText
 * @returns {string | null}
 */
function bulletSentenceViolation(bulletText) {
  const trimmed = bulletText.trim()
  if (!trimmed) return "Bullet item is empty."

  const startsOk = /^(\*\*|[A-Z]|\[|`)/.test(trimmed)
  if (!startsOk) {
    return "Bullet items must start with a capital letter, bold, a link, or an inline code span."
  }

  const endsOk = /(\.|[:?]|\)|`|])$/.test(trimmed)
  if (!endsOk) {
    return "Bullet items must end with '.', '?', ':', a closing parenthesis, code span, or link."
  }

  return null
}

/**
 * @param {string} body
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validatePrBody(body) {
  const errors = []

  if (body === undefined || body === null || String(body).trim() === "") {
    errors.push("PR body is empty.")
    return { ok: false, errors }
  }

  const typographyText = stripIgnoredRegions(body)
  const bulletText = stripIgnoredRegionsWithOptions(body, { stripInlineCode: false })

  if (CURLY_APOSTROPHE.test(typographyText)) {
    errors.push("Replace curly apostrophes with straight apostrophes.")
  }
  if (CURLY_QUOTE.test(typographyText)) {
    errors.push("Replace curly quotation marks with straight quotes.")
  }
  if (EN_EM_DASH.test(typographyText)) {
    errors.push("Replace en dashes and em dashes with a hyphen or rephrase.")
  }

  for (const line of typographyText.split("\n")) {
    for (const message of asciiDashViolationsInLine(line)) {
      if (!errors.includes(message)) errors.push(message)
    }
  }

  for (const line of bulletText.split("\n")) {
    const bulletMatch = line.match(BULLET_LINE)
    if (!bulletMatch) continue
    const violation = bulletSentenceViolation(bulletMatch[1])
    if (violation && !errors.includes(violation)) errors.push(violation)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}

function main() {
  const result = validatePrBody(process.env.PR_BODY ?? "")
  if (!result.ok) {
    console.error("PR body check failed:")
    for (const error of result.errors) {
      console.error(`- ${error}`)
    }
    process.exit(1)
  }
  console.log("PR body check passed.")
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main()
}
