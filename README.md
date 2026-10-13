# Shrinkcord

Shrinkcord shrinks JPEG, PNG, and WebP files for Discord’s free upload limit. Drop a file over 20 MiB and the browser encodes it to 19.5 MiB or under. Files already at or under 20 MiB are left unchanged. Nothing is uploaded to a server.

Built with [Next.js](https://nextjs.org) 16, React 19, and Tailwind CSS 4.

## Why 19.5 MB?

Discord’s free cap is 20 MB, documented as 20 MiB (20 × 1024 × 1024 bytes). Shrinkcord targets 19.5 MiB so the file clears that check with 0.5 MiB of room. See [`/discord-file-limit`](app/discord-file-limit/page.tsx) for Nitro, boosts, and how limits apply, and [Discord’s attachment FAQ](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ).

## How it works

1. Pick or drop one or more images (JPEG, PNG, WebP).
2. Each file over 20 MiB is decoded in the tab. Quality starts at 1.0 and searches down toward 19.5 MiB. Dimensions scale only if quality 0.5 is still too large.
3. Opaque PNGs become JPEG. PNGs with transparency try WebP, including scaled passes at quality 0.8 or higher. If that still exceeds the budget, they are flattened onto white and saved as JPEG.
4. Download the result. Shrunk files are named `your-photo-discord.jpg` or `.webp` when the output stays WebP.

Processing runs in a Web Worker when the browser supports it, with a main-thread fallback.

## Privacy

Images never leave your device. There is no backend storage or upload step for the compressor.

## Development

Requires Node.js 20+ and [pnpm](https://pnpm.io/installation) 10+ (Corepack: `corepack enable`, then the version pinned in `package.json`).

```bash
git clone https://github.com/ayomel/shrinkcord.git
cd shrinkcord
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

| Command       | Description              |
| ------------- | ------------------------ |
| `pnpm dev`    | Start dev server         |
| `pnpm build`  | Production build         |
| `pnpm start`  | Serve production build   |
| `pnpm lint`   | Run ESLint               |
| `pnpm test`   | Unit tests (`tsx --test`) |

### Environment

Set the public site URL for canonical links, sitemap, and Open Graph metadata.

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.com
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
