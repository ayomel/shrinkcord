import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { once } from "node:events"
import { after, before, beforeEach, describe, it } from "node:test"

import { GET as health } from "../../app/api/health/route.ts"
import { POST as upload } from "../../app/api/uploads/route.ts"
import { POST as createJob } from "../../app/api/jobs/route.ts"
import { GET as getJob } from "../../app/api/jobs/[id]/route.ts"
import { POST as cancelJob } from "../../app/api/jobs/[id]/cancel/route.ts"
import { GET as downloadJob } from "../../app/api/jobs/[id]/download/route.ts"

type CapturedRequest = {
  method?: string
  url?: string
  headers: IncomingMessage["headers"]
  body: string
}

let backend: ReturnType<typeof createServer>
let backendUrl: string
let captured: CapturedRequest[]
let upstreamStatus = 200
let upstreamBody = "{\"ok\":true}"
let healthContentType = "text/plain; charset=utf-8"

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

function respond(response: ServerResponse, status = upstreamStatus, body = upstreamBody) {
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

function jsonRequest(path: string, method: string, body: unknown, headers?: HeadersInit) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

before(async () => {
  backend = createServer(async (request, response) => {
    captured.push({ method: request.method, url: request.url, headers: request.headers, body: await readBody(request) })
    if (request.url === "/shrinkcord/health") {
      response.writeHead(upstreamStatus, { "content-type": healthContentType, "content-length": 2 })
      response.end("OK")
      return
    }
    respond(response)
  })
  backend.listen(0, "127.0.0.1")
  await once(backend, "listening")
  const address = backend.address()
  assert(address && typeof address === "object")
  backendUrl = `http://127.0.0.1:${address.port}/shrinkcord`
  process.env.SHRINKCORD_API_URL = backendUrl
})

after(async () => {
  delete process.env.SHRINKCORD_API_URL
  backend.close()
  await once(backend, "close")
})

beforeEach(() => {
  captured = []
  upstreamStatus = 200
  upstreamBody = "{\"ok\":true}"
  healthContentType = "text/plain; charset=utf-8"
  process.env.SHRINKCORD_API_URL = backendUrl
})

describe("fixed Shrinkcord API routes", () => {
  it("forwards health without forwarding caller credentials and disables caching", async () => {
    const response = await health(new Request("http://localhost/api/health", {
      headers: { cookie: "session=secret", authorization: "Bearer secret" },
    }))

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(await response.text(), "OK")
    assert.equal(captured[0]?.url, "/shrinkcord/health")
    assert.equal(captured[0]?.headers.cookie, undefined)
    assert.equal(captured[0]?.headers.authorization, undefined)

    healthContentType = "text/html; charset=utf-8"
    assert.equal(await (await health(new Request("http://localhost/api/health"))).text(), "OK")
  })

  it("validates upload content_length boundaries and rejects extra fields", async () => {
    const response = await upload(jsonRequest("/api/uploads", "POST", { content_length: 12 }))
    assert.equal(response.status, 200)
    assert.equal(captured[0]?.url, "/shrinkcord/uploads")
    assert.deepEqual(JSON.parse(captured[0]!.body), { content_length: 12 })

    for (const value of [0, -1, 1.5, "12", 524_288_001]) {
      const invalidSize = await upload(jsonRequest("/api/uploads", "POST", { content_length: value }))
      assert.equal(invalidSize.status, 400, `expected content_length=${String(value)} to be rejected`)
    }
    assert.equal((await upload(jsonRequest("/api/uploads", "POST", { content_length: 524_288_000 }))).status, 200)

    const invalid = await upload(jsonRequest("/api/uploads", "POST", {
      content_length: 12,
      file: "should not pass through",
    }))
    assert.equal(invalid.status, 400)
    assert.equal(captured.length, 2)
  })

  it("validates job creation, scopes idempotency forwarding, and preserves configured path prefix", async () => {
    const response = await createJob(jsonRequest("/api/jobs", "POST", {
      input_key: "upload_1/source.mp4",
      target_size_bytes: 1000,
    }, { "Idempotency-Key": "create:job_1" }))

    assert.equal(response.status, 200)
    assert.equal(captured[0]?.url, "/shrinkcord/jobs")
    assert.equal(captured[0]?.headers["idempotency-key"], "create:job_1")

    for (const value of [0, -1, 1.5, "1000", 524_288_001]) {
      const invalidSize = await createJob(jsonRequest("/api/jobs", "POST", {
        input_key: "upload_1/source.mp4",
        target_size_bytes: value,
      }))
      assert.equal(invalidSize.status, 400, `expected target_size_bytes=${String(value)} to be rejected`)
    }
    assert.equal((await createJob(jsonRequest("/api/jobs", "POST", {
      input_key: "upload_1/source.mp4",
      target_size_bytes: 524_288_000,
    }))).status, 200)

    for (const input_key of ["../private.mp4", "a..b", ".hidden", "/absolute", "bad:key", `a${"b".repeat(1024)}`]) {
      const invalid = await createJob(jsonRequest("/api/jobs", "POST", { input_key, target_size_bytes: 1000 }))
      assert.equal(invalid.status, 400, `expected input_key=${input_key.slice(0, 20)} to be rejected`)
    }

    const invalidKey = await createJob(jsonRequest("/api/jobs", "POST", {
      input_key: "valid/key.mp4",
      target_size_bytes: 1000,
    }, { "Idempotency-Key": "invalid key" }))
    assert.equal(invalidKey.status, 400)
    assert.equal(captured.length, 2)
  })

  it("requires UUIDv4 IDs for status, cancel, and download routes", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174000"
    assert.equal((await getJob(new Request(`http://localhost/api/jobs/${id}`), { params: Promise.resolve({ id }) })).status, 200)
    assert.equal((await cancelJob(new Request(`http://localhost/api/jobs/${id}/cancel`, { method: "POST" }), { params: Promise.resolve({ id }) })).status, 200)
    assert.equal((await downloadJob(new Request(`http://localhost/api/jobs/${id}/download`), { params: Promise.resolve({ id }) })).status, 200)
    assert.deepEqual(captured.map(({ url }) => url), [
      `/shrinkcord/jobs/${id}`,
      `/shrinkcord/jobs/${id}/cancel`,
      `/shrinkcord/jobs/${id}/download`,
    ])

    const invalid = await getJob(new Request("http://localhost/api/jobs/not-a-uuid"), { params: Promise.resolve({ id: "not-a-uuid" }) })
    assert.equal(invalid.status, 400)
    assert.equal(captured.length, 3)
  })

  it("sanitizes upstream errors while preserving status and maps missing configuration", async () => {
    upstreamStatus = 422
    upstreamBody = JSON.stringify({ message: ["Invalid input", "Try again"], stack: "internal", secret: "hidden" })
    const response = await createJob(jsonRequest("/api/jobs", "POST", {
      input_key: "valid/key.mp4",
      target_size_bytes: 1000,
    }))
    assert.equal(response.status, 422)
    assert.deepEqual(await responseBody(response), { message: ["Invalid input", "Try again"] })

    const url = process.env.SHRINKCORD_API_URL
    delete process.env.SHRINKCORD_API_URL
    const unavailable = await health(new Request("http://localhost/api/health"))
    process.env.SHRINKCORD_API_URL = url
    assert.equal(unavailable.status, 503)
  })

  it("rejects non-JSON and oversized create bodies before contacting the backend", async () => {
    const nonJson = await upload(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }))
    assert.equal(nonJson.status, 400)

    const oversized = await upload(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content_length: "x".repeat(9000) }),
    }))
    assert.equal(oversized.status, 400)
    assert.equal(captured.length, 0)

    const malformed = await upload(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    }))
    assert.equal(malformed.status, 400)
    assert.equal(captured.length, 0)
  })

  it("rejects unsafe configuration components and upstream redirects", async () => {
    process.env.SHRINKCORD_API_URL = `${backendUrl}?token=secret`
    assert.equal((await health(new Request("http://localhost/api/health"))).status, 503)
    process.env.SHRINKCORD_API_URL = backendUrl.replace("http://", "http://user:password@")
    assert.equal((await health(new Request("http://localhost/api/health"))).status, 503)
    process.env.SHRINKCORD_API_URL = `${backendUrl}#fragment`
    assert.equal((await health(new Request("http://localhost/api/health"))).status, 503)
    process.env.SHRINKCORD_API_URL = backendUrl.replace("http://", "ftp://")
    assert.equal((await health(new Request("http://localhost/api/health"))).status, 503)

    process.env.SHRINKCORD_API_URL = backendUrl
    upstreamStatus = 302
    const redirect = await health(new Request("http://localhost/api/health"))
    assert.equal(redirect.status, 502)
    assert.equal(redirect.headers.get("location"), null)
  })

  it("maps an unreachable configured backend to 503", async () => {
    process.env.SHRINKCORD_API_URL = "http://127.0.0.1:1/base"
    const response = await health(new Request("http://localhost/api/health"))
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("cache-control"), "no-store")
  })

  it("bounds upstream bodies without losing upstream error statuses", async () => {
    upstreamStatus = 422
    upstreamBody = "x".repeat(70_000)
    const failed = await createJob(jsonRequest("/api/jobs", "POST", {
      input_key: "valid/key.mp4",
      target_size_bytes: 1000,
    }))
    assert.equal(failed.status, 422)
    assert.deepEqual(await responseBody(failed), { message: "Upstream request failed" })

    upstreamStatus = 200
    const succeeded = await createJob(jsonRequest("/api/jobs", "POST", {
      input_key: "valid/key.mp4",
      target_size_bytes: 1000,
    }))
    assert.equal(succeeded.status, 502)
  })
})
