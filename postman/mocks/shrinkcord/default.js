/* eslint-disable @typescript-eslint/no-require-imports -- Postman mock handlers run as CommonJS. */
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const output = Buffer.from("AAAAFGZ0eXBpc29tAAAAAGlzb20=", "base64");
const headers = {
  "Access-Control-Allow-Origin": "http://localhost:5191",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Expose-Headers": "Content-Length, Retry-After",
};
const drainBody = (req) => req.readableEnded ? Promise.resolve() : new Promise((resolve) => { req.on("end", resolve); req.on("aborted", resolve); req.resume(); });
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { ...headers, "Content-Type": "application/json", ...extra });
  res.end(JSON.stringify(body));
};
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") { res.writeHead(204, headers); return res.end(); }
  if (url.pathname === "/health") return json(res, 200, { status: "ok" });
  if (url.pathname === "/qa/reset") {
    await pm.state.set("qa-mode", url.searchParams.get("mode") || "success");
    await pm.state.set("qa-jobs", {});
    await pm.state.set("qa-uploads", 0);
    await pm.state.set("qa-requests", []);
    return json(res, 200, { reset: true });
  }
  const requests = (await pm.state.get("qa-requests")) || [];
  requests.push({ method: req.method, path: req.url, origin: req.headers.origin || null });
  await pm.state.set("qa-requests", requests);
  if (url.pathname === "/qa/requests") return json(res, 200, requests);
  const mode = (await pm.state.get("qa-mode")) || "success";
  const jobs = (await pm.state.get("qa-jobs")) || {};
  if (req.method === "POST" && url.pathname === "/jobs") {
    await drainBody(req);
    const uploads = ((await pm.state.get("qa-uploads")) || 0) + 1;
    await pm.state.set("qa-uploads", uploads);
    if (mode === "busy" && uploads <= 2 || mode === "busy-exhausted") {
      return json(res, 429, { message: "Server busy" }, { "Retry-After": "0" });
    }
    const id = randomUUID();
    jobs[id] = { id, polls: 0, status: "QUEUED" };
    await pm.state.set("qa-jobs", jobs);
    return json(res, 201, { id });
  }
  const match = url.pathname.match(/^\/jobs\/([^/]+)(\/file)?$/);
  if (match) {
    const job = jobs[match[1]];
    if (!job) return json(res, 404, { message: "Job not found" });
    if (match[2]) return json(res, 500, { message: "QA regression: redirect endpoint was requested" });
    if (req.method === "DELETE") {
      job.status = "CANCELED";
      await pm.state.set("qa-jobs", jobs);
      return json(res, 200, { id: job.id, status: job.status, progress: 0 });
    }
    job.polls++;
    if (job.status !== "CANCELED") {
      job.status = mode === "failed" ? "FAILED" : mode === "cancel" ? "PROCESSING" : job.polls < 2 ? "QUEUED" : job.polls < 3 ? "PROCESSING" : "COMPLETED";
    }
    await pm.state.set("qa-jobs", jobs);
    const progress = job.status === "COMPLETED" ? 100 : job.status === "PROCESSING" ? 45 : 0;
    return json(res, 200, {
      id: job.id, status: job.status, progress,
      source_bytes: 2048, output_bytes: job.status === "COMPLETED" ? output.length : null,
      target_size_bytes: 20000000, error_message: job.status === "FAILED" ? "QA encoder failure" : null,
      download_url: job.status === "COMPLETED" ? `http://localhost:5190/api/objects/${job.id}.mp4?signature=keep%2Bexact` : null,
      expires_at: "2099-01-01T00:00:00Z",
    });
  }
  if (url.pathname.startsWith("/objects/")) {
    if (mode === "expired") return json(res, 403, { message: "Expired signature" });
    if (mode === "download-failed") return json(res, 503, { message: "Unavailable" });
    res.writeHead(200, { ...headers, "Content-Type": "video/mp4", "Content-Length": output.length });
    return res.end(output);
  }
  if (req.method === "POST" && url.pathname === "/uploads") {
    const id = randomUUID();
    return json(res, 201, {
      key: `image/${id}`, method: "PUT", headers: { "Content-Type": "image/jpeg" },
      upload_url: `http://localhost:5190/api/storage/${id}`, download_url: `http://localhost:5190/api/objects/${id}.jpg`,
      expires_at: "2099-01-01T00:00:00Z",
    });
  }
  if (req.method === "PUT" && url.pathname.startsWith("/storage/")) {
    await drainBody(req); res.writeHead(200, headers); return res.end();
  }
  return json(res, 501, { message: "Outside the frontend QA contract" });
}).listen(process.env.PORT || 5190);
