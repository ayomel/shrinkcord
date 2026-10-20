// Local API and storage stand-in derived from the backend README. No cloud resources are used.
// Postman executes handlers in a CommonJS VM.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("node:http")
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomUUID } = require("node:crypto")
const jobs = new Map(), uploads = new Map(), idempotency = new Map()
let scenario = {}, counts = {}
const origin = "http://localhost:4909/shrinkcord"
const reset = () => { scenario = {}; counts = { reservations: 0, puts: 0, creates: 0, statusReads: 0, cancels: 0, downloadLinks: 0, downloads: 0, keys: [] } }
reset()
http.createServer(async (req, res) => {
  const requestOrigin = req.headers.origin
  if (["http://localhost:3110", "http://localhost:3000"].includes(requestOrigin)) res.setHeader("Access-Control-Allow-Origin", requestOrigin)
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end() }
  const url = new URL(req.url, "http://fixture.invalid")
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)) }
  const fail = (status, message) => json(status, { statusCode: status, message, stack: "Internal diagnostics must not reach users." })
  if (url.pathname === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("OK") }
  const chunks = []
  try { for await (const chunk of req) chunks.push(chunk) } catch { return }
  const bytes = Buffer.concat(chunks)
  let body = {}
  if (bytes.length && req.headers["content-type"]?.includes("application/json")) {
    try { body = JSON.parse(bytes.toString()) } catch { return fail(400, "Invalid JSON") }
  }
  if (url.pathname === "/__qa/scenario" && req.method === "POST") {
    reset(); scenario = body; return json(200, { configured: true })
  }
  if (url.pathname === "/__qa/stats") return json(200, counts)
  if (url.pathname === "/uploads" && req.method === "POST") {
    counts.reservations++
    const key = "uploads/" + randomUUID() + ".mp4"
    uploads.set(key, { expected: body.content_length })
    return json(201, { key, upload_url: origin + "/storage/" + key })
  }
  if (url.pathname.startsWith("/storage/uploads/") && req.method === "PUT") {
    counts.puts++
    if (scenario.uploadFailures > 0) { scenario.uploadFailures--; return fail(503, "Upload temporarily unavailable.") }
    const key = url.pathname.slice("/storage/".length), upload = uploads.get(key)
    if (!upload || req.headers["content-type"] !== "video/mp4" || bytes.length !== upload.expected) return fail(400, "Upload length or content type does not match.")
    upload.bytes = bytes
    res.writeHead(200); return res.end()
  }
  if (url.pathname === "/jobs" && req.method === "POST") {
    counts.creates++
    const key = req.headers["idempotency-key"]
    counts.keys.push(key)
    const signature = JSON.stringify(body)
    if (idempotency.has(key)) {
      const old = idempotency.get(key)
      return old.signature === signature ? json(201, { jobId: old.id }) : fail(409, "Idempotency key was used with different parameters.")
    }
    if (scenario.jobFailures > 0) { scenario.jobFailures--; return fail(503, "Job service temporarily unavailable.") }
    if (!uploads.get(body.input_key)?.bytes) return fail(400, "Input object not found.")
    const id = randomUUID(), now = new Date().toISOString()
    jobs.set(id, { id, status: "QUEUED", progress: 0, attempts: 0, input_key: body.input_key,
      target_size_bytes: body.target_size_bytes, output_expired: false, created_at: now, updated_at: now, reads: 0 })
    idempotency.set(key, { id, signature })
    if (scenario.lostJobResponses > 0) { scenario.lostJobResponses--; return req.socket.destroy() }
    return json(201, { jobId: id })
  }
  const match = url.pathname.match(/^\/jobs\/([a-f0-9-]+)(\/download|\/cancel)?$/)
  if (match) {
    const forced = { "40000000": 400, "40900000": 409, "41000000": 410, "42900000": 429, "50300000": 503 }[match[1].slice(0, 8)]
    if (forced) return fail(forced, "Fixture upstream error.")
    if (match[1].startsWith("50000000")) { res.writeHead(500, { "Content-Type": "text/html" }); return res.end("<html>Internal proxy diagnostics</html>") }
    if (match[1].startsWith("50400000")) { const timer = setTimeout(() => json(200, {}), 20000); res.on("close", () => clearTimeout(timer)); return }
    const job = jobs.get(match[1])
    if (!job) return fail(404, "Job not found.")
    if (match[2] === "/cancel" && req.method === "POST") {
      counts.cancels++
      if (scenario.cancelCompletes) { job.status = "COMPLETED"; job.progress = 100; return fail(409, "Job is already completed.") }
      if (["COMPLETED", "FAILED", "CANCELED"].includes(job.status)) return fail(409, "Job is already terminal.")
      job.status = "CANCELED"; return json(200, job)
    }
    if (match[2] === "/download") {
      counts.downloadLinks++
      if (scenario.expireOutput) return fail(410, "Output has expired.")
      if (job.status !== "COMPLETED") return fail(409, "Job is not completed.")
      return json(200, { url: origin + "/storage/outputs/" + job.id + ".mp4?expired=" + (scenario.expiredLinks-- > 0 ? "1" : "0") })
    }
    counts.statusReads++
    if (scenario.statusFailures > 0) { scenario.statusFailures--; return fail(503, "Monitoring temporarily unavailable.") }
    if (!["COMPLETED", "FAILED", "CANCELED"].includes(job.status) && !scenario.holdJobs) {
      job.reads++
      job.status = job.reads < 4 ? "PROCESSING" : "COMPLETED"
      job.progress = [0, 15, 55, 90, 100][Math.min(job.reads, 4)]
      if (scenario.failJob || job.target_size_bytes < 2048) {
        job.status = "FAILED"; job.progress = 0
        job.error_message = "Target size is too small to encode this video. Increase the target size and try again."
      }
      if (job.status === "COMPLETED") {
        job.output_key = "outputs/" + job.id + ".mp4"
        job.output_expires_at = new Date(Date.now() + 86400000).toISOString()
        job.completed_at = new Date().toISOString()
      }
    }
    return json(200, job)
  }
  if (url.pathname.startsWith("/storage/outputs/")) {
    counts.downloads++
    if (url.searchParams.get("expired") === "1") return fail(403, "Signed URL expired.")
    const id = url.pathname.split("/").pop().replace(".mp4", ""), job = jobs.get(id)
    if (!job) return fail(404, "Output not found.")
    const output = uploads.get(job.input_key)?.bytes
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": output.length })
    return res.end(output)
  }
  fail(501, "Endpoint outside this fixture.")
}).listen(process.env.PORT)
