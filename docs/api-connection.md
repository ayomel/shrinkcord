# Shrinkcord API connection (browser)

The web app calls the compression API from the browser with CORS. Video bodies are not proxied through Vercel Functions.

## Configuration

```bash
NEXT_PUBLIC_SHRINKCORD_API_URL=https://your-api.example.com
```

In production this variable is required. When it is missing, the UI disables video uploads and still shrinks images locally.

In development, unset `NEXT_PUBLIC_SHRINKCORD_API_URL` uses `http://localhost:3000`.

`SHRINKCORD_API_URL` is only used by `GET /api/health` on the Next.js server.

## HTTP contract

See shrinkcord-api PR #43 (commit 3f13c84 on `feat/single-ffmpeg-server-aea8`):

- `POST /jobs` multipart (`file`, optional `target_size_bytes`), 429 with `Retry-After`
- `GET /jobs/:id` job JSON (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELED`)
- `GET /jobs/:id/file` MP4 with `Content-Length`
- `DELETE /jobs/:id` cancel; 409 when already terminal

The UI uses XHR upload progress, honors `Retry-After` on 429, polls job status, maps errors by HTTP status, and deletes server jobs on cancel, remove, or clear.
