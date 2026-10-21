# Shrinkcord API connection (browser)

The Shrinkcord web app talks to the compression API **directly from the browser** with CORS. Large video bodies are not proxied through Vercel Functions.

## Configuration

Set the public API origin:

```bash
NEXT_PUBLIC_SHRINKCORD_API_URL=https://shrinkcord-api.up.railway.app
```

In local development, when this variable is unset, the app uses `http://localhost:3000` (the default `pnpm dev` port for shrinkcord-api).

The server-only `SHRINKCORD_API_URL` is still used by `GET /api/health` to report upstream health from Next.js. Video workflows do not use it.

## HTTP contract

See the [single FFmpeg server PR](https://github.com/ayomel/shrinkcord-api/pull/43) for the authoritative contract:

- `POST /jobs` — multipart upload (`file`, optional `target_size_bytes`)
- `GET /jobs/:id` — job status and `progress`
- `GET /jobs/:id/file` — completed MP4 download
- `DELETE /jobs/:id` — cancel

The UI uploads with `XMLHttpRequest` for progress events, polls job status, retries `POST /jobs` on HTTP 429, and maps 400/413/415 errors to user-facing messages.
