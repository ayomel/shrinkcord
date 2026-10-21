# Shrinkcord

Shrinkcord compresses images in your browser and MP4/MOV videos through the Shrinkcord API.

Image compression keeps its existing behavior: images over 20 MiB are encoded to 19.5 MiB or under, while images at or under 20 MiB are left unchanged. Video compression accepts MP4 and iPhone MOV files up to 500 MiB and 10 minutes. The default encode target is 20 MB (20,000,000 bytes).

Built with [Next.js](https://nextjs.org) 16, React 19, and Tailwind CSS 4.

## Image compression

1. Pick or drop one or more images (JPEG, PNG, WebP).
2. Each image over 20 MiB is decoded in the tab. Quality starts at 1.0 and searches down toward 19.5 MiB. Dimensions scale only if quality 0.5 is still too large.
3. Opaque PNGs become JPEG. PNGs with transparency try WebP (alpha preserved), including scaled passes at quality ≥ 0.8. If that still exceeds the budget, they are flattened onto white and saved as JPEG.
4. Download the result. Shrunk images are named `your-photo-discord.jpg` (or `.webp` when the output stays WebP).

Image processing runs in a Web Worker when the browser supports it, with a main-thread fallback.

## Why 19.5 MB?

Discord’s free cap is 20 MB, documented as 20 MiB (20 × 1024 × 1024 bytes). Shrinkcord targets 19.5 MiB so the file clears that check with 0.5 MiB of room. See [`/discord-file-limit`](app/discord-file-limit/page.tsx) for Nitro, boosts, and how limits apply, and [Discord’s attachment FAQ](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ).

## MP4 / MOV video compression

Drop MP4 or iPhone MOV videos in the same control as images. The browser uploads each video directly to the Shrinkcord API (multipart `POST /jobs`), polls job status, and downloads the finished `*-discord.mp4`. Only one video upload runs at a time; the client waits and retries when the API returns HTTP 429.

Client-side checks before upload: max **500 MiB** file size and **10 minutes** duration when the browser can read metadata (files that cannot be previewed, e.g. HEVC in Chrome, still upload).

## Privacy

Image files stay on your device during compression. Video files are uploaded to the Shrinkcord API for server-side encoding and are removed after download or expiry on the server.

## Development

Requires Node.js 20+ and [pnpm](https://pnpm.io/installation) 10+ (Corepack: `corepack enable`, then the version pinned in `package.json`).

```bash
git clone https://github.com/ayomel/shrinkcord.git
cd shrinkcord
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) (the dev server avoids port 3000 so shrinkcord-api can use it). For video compression locally, run [shrinkcord-api](https://github.com/ayomel/shrinkcord-api) with `pnpm dev` on port 3000, or set `NEXT_PUBLIC_SHRINKCORD_API_URL`.

| Command       | Description              |
| ------------- | ------------------------ |
| `pnpm dev`    | Start dev server         |
| `pnpm build`  | Production build         |
| `pnpm start`  | Serve production build   |
| `pnpm lint`   | Run ESLint               |
| `pnpm test`   | Unit tests (`tsx --test`) |

### Environment

| Variable | Where | Purpose |
| -------- | ----- | ------- |
| `NEXT_PUBLIC_SHRINKCORD_API_URL` | Browser (public) | Shrinkcord API origin for video uploads and job polling. In dev, defaults to `http://localhost:3000` when unset. In production, defaults to `https://shrinkcord-api.up.railway.app` when unset. |
| `NEXT_PUBLIC_SITE_URL` | Build / browser | Canonical site URL for SEO metadata. |
| `SHRINKCORD_API_URL` | Server only | Upstream API for `GET /api/health` (e.g. `https://shrinkcord-api.up.railway.app`). Not used for video uploads. |

Example `.env.local`:

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:5173
NEXT_PUBLIC_SHRINKCORD_API_URL=http://localhost:3000
SHRINKCORD_API_URL=http://localhost:3000
```

Site URL resolution:

1. `NEXT_PUBLIC_SITE_URL` (preferred for a custom domain)
2. `https://${VERCEL_PROJECT_PRODUCTION_URL}` on Vercel builds
3. `https://shrinkcord.vercel.app` as the production fallback
4. `http://localhost:3000` only when `NODE_ENV === "development"`

## Project layout

```text
app/                 Pages, layout, SEO (sitemap, robots, OG image)
components/          UI and the unified media drop zone
lib/compress.ts      Client-side shrink logic
lib/limits.ts        20 / 19.5 MiB constants and helpers
lib/shrinkcord-api-client.ts  Direct browser API client for videos
```

UI pieces come from [ObsidianUI](https://www.obsidianui.dev/) and [EasyUI](https://easyui.site/) via the shadcn registry, restyled to Discord’s dark palette and blurple accent.

## Disclaimer

Shrinkcord is not affiliated with Discord. Discord is a trademark of Discord Inc. This project uses Discord’s public brand colors for familiarity only. It does not use Discord logos or other branded assets.
