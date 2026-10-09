# Shrinkcord

Shrinkcord is a small web tool for Discord’s free upload limit. Drop a JPEG, PNG, or WebP that is **over 20 MiB**, and the browser brings it down to **19.5 MiB or under**. Files already at or under 20 MiB are left unchanged. Nothing is uploaded to a server.

Built with [Next.js](https://nextjs.org) 16, React 19, and Tailwind CSS 4.

## Why 19.5 MB?

Discord’s free cap is **20 MB**, and Discord documents that as **20 MiB** (20 × 1024 × 1024 bytes). Shrinkcord targets **19.5 MiB** so the file clears the limit with a little room to spare. The app includes a [`/discord-file-limit`](app/discord-file-limit/page.tsx) article on Nitro, boosts, and how limits apply; see also [Discord’s attachment FAQ](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ).

## How it works

1. Pick or drop one or more images (JPEG, PNG, WebP).
2. Each file over 20 MiB is decoded in the tab, quality is lowered first, and dimensions are scaled only if needed.
3. PNG is saved as JPEG (transparency flattened onto white) because lossless PNG cannot hit a byte budget by quality alone.
4. Download the result; shrunk files are named `your-photo-discord.jpg` (or `.webp` when the output stays WebP).

Processing runs in a Web Worker when the browser supports it, with a main-thread fallback.

## Privacy

Images never leave your device. There is no backend storage or upload step for the compressor.

## Development

**Requirements:** Node.js 20+ and [pnpm](https://pnpm.io/installation) 10+ (Corepack: `corepack enable` then use the version pinned in `package.json`).

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

### Environment

Set the public site URL for canonical links, sitemap, and Open Graph metadata:

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

If unset, metadata defaults to `http://localhost:3000`.

## Project layout

```text
app/                 Pages, layout, SEO (sitemap, robots, OG image)
components/          UI and the compressor drop zone
lib/compress.ts      Client-side shrink logic
lib/limits.ts        20 / 19.5 MiB constants and helpers
```

UI pieces come from [ObsidianUI](https://www.obsidianui.dev/) and [EasyUI](https://easyui.site/) via the shadcn registry, restyled to Discord’s dark palette and blurple accent.

## Disclaimer

Shrinkcord is **not affiliated with Discord**. Discord is a trademark of Discord Inc. This project uses Discord’s public brand colors for familiarity only; it does not use Discord logos or other branded assets.
