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

Video jobs (see shrinkcord-api PR #45):

- `POST /jobs` multipart (`file`, optional `target_size_bytes`), 429 with `Retry-After`
- `GET /jobs/:id` job JSON (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELED`)
- Completed jobs include `key`, `download_url` (presigned GET, 7 days), and `expires_at`
- `GET /jobs/:id/file` redirects to `download_url`
- `DELETE /jobs/:id` cancel; 409 when already terminal

Image storage (7-day R2, shrinkcord-api PR #45):

- `POST /uploads` JSON `{ filename, content_type, size, previous_key? }` (images only, 50 MiB cap)
- Response `{ key, upload_url, method: "PUT", headers, download_url, expires_at }`
- Client `PUT`s compressed bytes to `upload_url` with the returned headers; `412` means retry `POST /uploads` with `previous_key`

The UI uploads compressed images after browser encoding, shows upload progress, and surfaces `download_url` when saving succeeds. Compression still finishes when storage is unavailable.
