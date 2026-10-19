// Local contract fixture for the frontend gateway; no cloud resources are created.
// Postman executes handlers in a CommonJS VM without dynamic import support.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("node:http")
const jobs = new Map()
const keys = new Map()
const id = "11111111-1111-4111-8111-111111111111"

http.createServer(async (req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" })
    return res.end("OK")
  }
  let text = ""
  for await (const chunk of req) text += chunk
  let body
  try { body = text ? JSON.parse(text) : {} }
  catch { return json(400, { message: "Invalid JSON", statusCode: 400 }) }

  if (req.url === "/uploads" && req.method === "POST") {
    return json(201, { upload_url: "https://storage.example.invalid/upload", key: "uploads/fixture.mp4" })
  }
  if (req.url === "/jobs" && req.method === "POST") {
    const key = req.headers["idempotency-key"]
    if (key && keys.has(key) && keys.get(key) !== text) {
      return json(409, { message: "Idempotency key was already used with different parameters.", statusCode: 409 })
    }
    if (key) keys.set(key, text)
    jobs.set(id, { id, status: "QUEUED", progress: 0, attempts: 0,
      input_key: body.input_key, target_size_bytes: body.target_size_bytes })
    return json(201, { jobId: id })
  }
  const match = req.url.match(/^\/jobs\/([a-f0-9-]+)(\/download|\/cancel)?$/)
  if (match) {
    // Fixed IDs select failures without adding test headers to production code.
    const status = { "40000000": 400, "40900000": 409, "41000000": 410, "42900000": 429, "50300000": 503 }[match[1].slice(0, 8)]
    if (status) return json(status, { statusCode: status, message: {
      400: "Invalid job request.", 409: "Job is not completed.", 410: "Output has expired.",
      429: "Too many requests.", 503: "Storage is unavailable."
    }[status], stack: "This internal detail must not reach the browser." })
    if (match[1].startsWith("50000000")) {
      res.writeHead(500, { "Content-Type": "text/html" })
      return res.end("<html>Internal proxy diagnostics</html>")
    }
    if (match[1].startsWith("50400000")) {
      const timer = setTimeout(() => json(200, { status: "PROCESSING" }), 20000)
      res.on("close", () => clearTimeout(timer))
      return
    }
    const job = jobs.get(match[1])
    if (!job) return json(404, { statusCode: 404, message: "Job not found." })
    if (match[2] === "/download") return json(409, { statusCode: 409, message: "Job is not completed." })
    if (match[2] === "/cancel" && req.method === "POST") {
      if (job.status === "CANCELED") return json(409, { statusCode: 409, message: "Job is already terminal." })
      job.status = "CANCELED"
    }
    return json(200, job)
  }
  json(501, { message: "Endpoint outside this fixture." })
}).listen(process.env.PORT)
