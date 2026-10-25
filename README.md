# Shrinkcord

**Make oversized images and videos easier to share on Discord.** Shrinkcord compresses images in your browser and MP4/MOV videos through the Shrinkcord API.

[Run locally](#development) · [How it works](#how-it-works) · [Quick walkthrough](#quick-walkthrough)

Images over 20 MiB are encoded to 19.5 MiB or under in the tab; images at or under 20 MiB are left unchanged. Videos upload to the API (max 500 MiB, 10 minutes when metadata is readable). Default encode target is 20,000,000 bytes.

Built with Next.js 16, React 19, and Tailwind CSS 4.

## How it works

| Input | Processing | Result |
| --- | --- | --- |
| JPEG, PNG, WebP | Browser compression, using a Web Worker when available | Downloadable image with a `-discord` filename |
| MP4, MOV | API upload, background processing, and client status polling | Downloadable `*-discord.mp4` |

### Engineering decisions

- **Process images in the browser.** A Web Worker handles image processing when available, keeping that work off the main thread.
- **Adjust quality before dimensions.** Oversized images search for a suitable quality level before reducing resolution.
- **Treat video processing as a job.** The client uploads the file, polls its status, and offers the finished download.
- **Respect API limits.** Uploads run one at a time, and HTTP 429 responses wait for `Retry-After` before retrying.

## Image compression

1. Pick or drop images (JPEG, PNG, WebP).
2. Each image over 20 MiB is decoded in the tab. Quality searches down toward 19.5 MiB; dimensions scale only if needed.
3. Opaque PNGs become JPEG. PNGs with transparency try WebP first, then flatten to JPEG if needed.
4. Download results named with `-discord`.

Image processing uses a Web Worker when available.

## Video compression

Drop MP4 or MOV in the same control as images. The browser uploads to the API (`POST /jobs`), polls status, and downloads `*-discord.mp4`. One upload runs at a time; HTTP 429 waits for `Retry-After` before retrying.

Images compress in the browser; only the smaller compressed output is saved online for 7 days when the API is configured. Videos upload to the server, the original is deleted after processing, and the compressed output is stored for 7 days.

## Quick walkthrough

After starting the app locally:

1. Drop a JPEG, PNG, or WebP larger than 20 MiB into the upload control.
2. Download the result and compare its size and appearance with the original.
3. Try an image at or below 20 MiB to check the unchanged-file path.
4. With the API configured, upload an MP4 or MOV, follow its processing status, and download the result.

Local image compression works without the API. Video processing requires a running Shrinkcord API; its source repository is currently private.

## Development

Requires Node.js 20+ and pnpm 10+.

```bash
git clone https://github.com/ayomel/shrinkcord.git
cd shrinkcord
pnpm install
pnpm dev
```

Open http://localhost:5173 by default (`PORT` overrides the dev port). Run shrinkcord-api on port 3000 for local video jobs, or set `NEXT_PUBLIC_SHRINKCORD_API_URL`.

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests |

### Environment

| Variable | Where | Purpose |
| -------- | ----- | ------- |
| `NEXT_PUBLIC_SHRINKCORD_API_URL` | Browser | API origin for video uploads. Required in production. Dev defaults to `http://localhost:3000` when unset. |
| `NEXT_PUBLIC_SITE_URL` | Build | Canonical site URL |
| `SHRINKCORD_API_URL` | Server | `GET /api/health` upstream only |

Example `.env.local`:

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:5173
NEXT_PUBLIC_SHRINKCORD_API_URL=http://localhost:3000
SHRINKCORD_API_URL=http://localhost:3000
```

Without `NEXT_PUBLIC_SHRINKCORD_API_URL` in production, video intake is disabled and images still work.

## Disclaimer

Shrinkcord is not affiliated with Discord.
