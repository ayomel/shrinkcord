import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  getShrinkcordApiBaseUrl,
  isShrinkcordCloudStorageConfigured,
  isShrinkcordVideoApiConfigured,
} from "./shrinkcordApiUrl.ts"

describe("shrinkcord API URL", () => {
  it("requires NEXT_PUBLIC_SHRINKCORD_API_URL in production builds", () => {
    const original = process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
    const nodeEnv = process.env.NODE_ENV
    process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = ""
    process.env.NODE_ENV = "production"
    try {
      assert.equal(isShrinkcordVideoApiConfigured(), false)
      assert.throws(() => getShrinkcordApiBaseUrl(), /not configured/i)
    } finally {
      process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = original
      process.env.NODE_ENV = nodeEnv
    }
  })

  it("treats cloud storage as disabled without NEXT_PUBLIC_SHRINKCORD_API_URL", () => {
    const original = process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
    const nodeEnv = process.env.NODE_ENV
    delete process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
    process.env.NODE_ENV = "development"
    try {
      assert.equal(isShrinkcordCloudStorageConfigured(), false)
      assert.equal(isShrinkcordVideoApiConfigured(), true)
    } finally {
      process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = original
      process.env.NODE_ENV = nodeEnv
    }
  })

  it("falls back to localhost in development", () => {
    const original = process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
    const nodeEnv = process.env.NODE_ENV
    delete process.env.NEXT_PUBLIC_SHRINKCORD_API_URL
    process.env.NODE_ENV = "development"
    try {
      assert.equal(isShrinkcordVideoApiConfigured(), true)
      assert.equal(getShrinkcordApiBaseUrl(), "http://localhost:3000")
    } finally {
      process.env.NEXT_PUBLIC_SHRINKCORD_API_URL = original
      process.env.NODE_ENV = nodeEnv
    }
  })
})
