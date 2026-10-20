# Shrinkcord

Shrinkcord has two compression workflows. JPEG, PNG, and WebP images are compressed in your browser. MP4 videos are uploaded to storage and compressed by a server-side job.

Image compression keeps its existing behavior: images over 20 MiB are encoded to 19.5 MiB or under, while images at or under 20 MiB are left unchanged. Video compression accepts one MP4 up to 524,288,000 bytes (500 MiB). Its default target is 20 MB (20,000,000 bytes).

Built with [Next.js](https://nextjs.org) 16, React 19, and Tailwind CSS 4.

## Image compression

1. Pick or drop one or more images (JPEG, PNG, WebP).
2. Each image over 20 MiB is decoded in the tab. Quality starts at 1.0 and searches down toward 19.5 MiB. Dimensions scale only if quality 0.5 is still too large.
3. Opaque PNGs become JPEG. PNGs with transparency try WebP (alpha preserved), including scaled passes at quality ≥ 0.8. If that still exceeds the budget, they are flattened onto white and saved as JPEG.
4. Download the result. Shrunk images are named `your-photo-discord.jpg` (or `.webp` when the output stays WebP).

Image processing runs in a Web Worker when the browser supports it, with a main-thread fallback.

## Why 19.5 MB?

Discord’s free cap is 20 MB, documented as 20 MiB (20 × 1024 × 1024 bytes). Shrinkcord targets 19.5 MiB so the file clears that check with 0.5 MiB of room. See [`/discord-file-limit`](app/discord-file-limit/page.tsx) for Nitro, boosts, and how limits apply, and [Discord’s attachment FAQ](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ).

## MP4 video compression

Choose one MP4 up to 524,288,000 bytes (500 MiB). The browser sends video bytes directly to temporary object storage using a short-lived upload URL; the application gateway handles job and upload metadata as JSON. A server-side job then compresses the video. The default target is 20 MB (20,000,000 bytes). The selected File stays in the current page session; refreshing or reopening the page clears the selection, so select the video again before submitting.

The video workflow uses temporary input and output storage. Output availability can expire. Shrinkcord does not promise a fixed retention period here.

## Privacy

Image files stay on your device during compression and are not uploaded. MP4 files are uploaded for server-side compression and may be stored temporarily while the job runs and the output is available.

## Release verification

Release verification for the video workflow is deferred. See [shrinkcord-api issue #39](https://github.com/ayomel/shrinkcord-api/issues/39). This README does not mark the remaining acceptance criteria as verified.

## Development

Requires Node.js 20+ and [pnpm](https://pnpm.io/installation) 10+ (Corepack: `corepack enable`, then the version pinned in `package.json`).

```bash
git clone https://github.com/ayomel/shrinkcord.git
cd shrinkcord
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Configure the API environment variable below to use video compression.

| Command       | Description              |
| ------------- | ------------------------ |
| `pnpm dev`    | Start dev server         |
| `pnpm build`  | Production build         |
| `pnpm start`  | Serve production build   |
| `pnpm lint`   | Run ESLint               |
| `pnpm test`   | Unit tests (`tsx --test`) |

### Environment

Set the public site URL for canonical links, sitemap, and Open Graph metadata. Set the server-only `SHRINKCORD_API_URL` to the API service URL for video compression. Keep storage credentials on the backend; browser requests use signed URLs. The bucket must allow the exact application origin, PUT and GET methods, and the `Content-Type` request header through CORS.

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.com
SHRINKCORD_API_URL=https://shrinkcord-api.up.railway.app
```

Resolution order:

1. `NEXT_PUBLIC_SITE_URL` (preferred for a custom domain)
2. `https://${VERCEL_PROJECT_PRODUCTION_URL}` on Vercel builds
3. `https://shrinkcord.vercel.app` as the production fallback
4. `http://localhost:3000` only when `NODE_ENV === "development"`

## Project layout

```text
app/                 Pages, layout, SEO (sitemap, robots, OG image)
components/          UI and the compressor drop zone
lib/compress.ts      Client-side shrink logic
lib/limits.ts        20 / 19.5 MiB constants and helpers
```

UI pieces come from [ObsidianUI](https://www.obsidianui.dev/) and [EasyUI](https://easyui.site/) via the shadcn registry, restyled to Discord’s dark palette and blurple accent.

## Disclaimer

Shrinkcord is not affiliated with Discord. Discord is a trademark of Discord Inc. This project uses Discord’s public brand colors for familiarity only. It does not use Discord logos or other branded assets.
