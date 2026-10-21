#!/usr/bin/env node

const CURLY_APOSTROPHE = /[\u2018\u2019]/u
const CURLY_QUOTE = /[\u201C\u201D]/u
const EN_EM_DASH = /[\u2013\u2014]/u

const BULLET_LINE = /^\s*(?:[-*+]|\d+\.)\s+(.+)$/

/**
 * Remove regions that should not be linted (comments, code, HTML blocks).
 * @param {string} body
 * @returns {string}
 */
export function stripIgnoredRegions(body) {
  let text = body
  text = text.replace(/<!--[\s\S]*?-->/g, "")
  text = text.replace(/```[\s\S]*?```/g, "")
  text = text.replace(/`[^`\n]*`/g, "")

  const blockTags = ["div", "table", "section", "footer", "header", "nav", "span"]
  let previous = ""
  while (text !== previous) {
    previous = text
    for (const tag of blockTags) {
      text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "")
    }
    text = text.replace(/<[^>]+>/g, "")
  }
  return text
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function asciiDashViolationsInLine(line) {
  const listMatch = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/)
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

  const startsOk = /^([A-Z]|`)/.test(trimmed)
  if (!startsOk) {
    return "Bullet items must start with a capital letter or an inline code span."
  }

  const endsOk = /(\.|:|`|])$/.test(trimmed)
  if (!endsOk) {
    return "Bullet items must end with '.', ':', a closing code span, or a link."
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

  const inspectable = stripIgnoredRegions(body)

  if (CURLY_APOSTROPHE.test(inspectable)) {
    errors.push("Replace curly apostrophes with straight apostrophes.")
  }
  if (CURLY_QUOTE.test(inspectable)) {
    errors.push("Replace curly quotation marks with straight quotes.")
  }
  if (EN_EM_DASH.test(inspectable)) {
    errors.push("Replace en dashes and em dashes with a hyphen or rephrase.")
  }

  for (const line of inspectable.split("\n")) {
    for (const message of asciiDashViolationsInLine(line)) {
      if (!errors.includes(message)) errors.push(message)
    }
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
