# Compression API connection

Stage 1 adds server routes for the video workflow. The current image compressor continues to run locally. See [issue #6](https://github.com/ayomel/shrinkcord/issues/6) for the QA gate.

## Configuration

Set this server-only variable in `.env.local` for development and in the hosting provider's environment for deployments:

```dotenv
SHRINKCORD_API_URL=https://shrinkcord-api.up.railway.app
```

Do not prefix it with `NEXT_PUBLIC_`. No R2 credentials belong in the frontend. Restart the server after changing local configuration. An unset or invalid API URL returns a recoverable 503 response.

## Routes

| Frontend route | Upstream operation |
| --- | --- |
| GET /api/health | GET /health |
| POST /api/uploads | POST /uploads |
| POST /api/jobs | POST /jobs |
| GET /api/jobs/:id | GET /jobs/:id |
| POST /api/jobs/:id/cancel | POST /jobs/:id/cancel |
| GET /api/jobs/:id/download | GET /jobs/:id/download |

Upload requests accept optional integer `content_length`. Job creation accepts `input_key` and `target_size_bytes`, with optional `Idempotency-Key` in the request headers. Both byte fields use the API's 1–524,288,000 range. IDs must be UUID v4. See the [backend contract](https://github.com/ayomel/shrinkcord-api) for payloads and lifecycle behavior.

Only the documented JSON fields and idempotency header are forwarded. Browser cookies and authorization headers are not sent upstream. Requests and responses are uncached, requests time out after 15 seconds, and upstream errors retain their status with a safe message. The gateway does not follow upstream redirects.

The gateway only handles small JSON requests. Send the MP4 bytes directly to the returned R2 upload URL with `Content-Type: video/mp4`. Pass the file size as `content_length` when requesting that URL, but let the browser set the PUT's `Content-Length`. Fetch output bytes directly from the signed download URL.

## Browser CORS prerequisite

R2 must allow the exact local and deployed frontend origins. Allow PUT for uploads, GET for readable downloads, and the Content-Type request header. The browser sends any needed preflight automatically. Add HEAD only if a future caller uses it. Expose Content-Length only if a future caller reads that header; size can instead come from the downloaded Blob.

Verify this with a real browser. A successful curl upload does not prove browser CORS. The API gateway avoids cross-origin API requests but does not bypass R2's policy. A passing health response checks the API process only, not storage, Redis, MongoDB, or the worker.

## Repeatable checks

Run `pnpm test`, `pnpm lint`, and `pnpm build`. The test command includes type generation, type checking, existing image tests, and gateway tests against a local HTTP server.

For requests through a running Next.js server, use the checked-in Postman fixture:

```powershell
postman simulation run postman/simulations/api-connection.sim.yaml --port 4906 --output ndjson --no-history
```

In a separate terminal:

```powershell
$env:SHRINKCORD_API_URL = 'http://127.0.0.1:4906/shrinkcord'
pnpm dev --port 3106
```

The fixture is based on the backend README and controllers. Published mocks were not searched because the local Postman CLI was signed out. It provides synthetic metadata only; its storage URLs are deliberately unusable. It is not a compression worker or proof of R2 readiness.

1. GET `http://localhost:3106/api/health` should return 200 and `OK`.
2. POST an upload request and a job request. Expect 201 and the documented response keys.
3. GET the returned job ID; cancel it; fetch it again. Expect QUEUED, then CANCELED.
4. To select upstream failures, GET `/api/jobs/<prefix>-1111-4111-8111-111111111111` with prefixes `40000000`, `40900000`, `41000000`, `42900000`, or `50300000`. Expect the matching status and a useful message without the fixture's internal stack field.
5. Prefix `50000000` sends HTML diagnostics. Expect a safe JSON error with status 500. Prefix `50400000` delays for 20 seconds. Expect a 504 timeout after approximately 15 seconds.
6. Stop the simulator and repeat health. Expect 503. Restart it and expect 200 without resubmitting jobs.
7. Confirm unsupported paths, invalid IDs, unknown body fields, and media request bodies cannot reach upstream operations.

For live integration, restore the Railway URL, then use a small synthetic MP4 in the browser to request an upload URL, PUT it to R2, create and poll a job, request its download link, and fetch readable output bytes. Repeat R2 checks from the deployed frontend origin. Record tested origins and any configuration blockers in the PR; do not commit signed URLs.

## QA snapshot: October 18, 2026

The gateway passed local HTTP contract tests, full lint, and controlled requests through a production Next.js server. The Postman run covered 201/200 success, 400/404/409/410/429/503 errors, HTML error sanitization, a 15-second timeout returning 504, and rejection of unsupported paths and methods. Simulator logs confirmed upstream requests; signed URLs were excluded from evidence.

Live Railway health returned 200 through the gateway. A 59,779-byte synthetic MP4 uploaded successfully outside the browser, completed compression through the gateway, and produced a readable 158,383-byte output below the 200,000-byte test target. The deliberately generous test target establishes transport and worker operation, not size savings.

**R2 CORS blocks browser readiness.** Real Chrome PUT attempts failed from `http://localhost:3106`, `http://localhost:3000`, and `https://shrinkcord.vercel.app`. OPTIONS preflights returned 403 without Access-Control-Allow-Origin. Browser GETs of the completed output also failed from all three origins; the same output returned 200 outside the browser without Access-Control-Allow-Origin. Configure the bucket's allowed origins, PUT/GET methods, and Content-Type request header, then repeat browser QA before signing off stage 1. The deployed page was used to establish its real origin; these new gateway routes have not yet been deployed there.
