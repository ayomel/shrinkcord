function resolveSiteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000"
  }

  return "https://shrinkcord.vercel.app"
}

export const site = {
  name: "Shrinkcord",
  url: resolveSiteUrl(),
  title: "Compress images and videos for Discord | Shrinkcord",
  description:
    "Shrink JPEG, PNG, and WebP images on your device. Upload MP4 videos for server-side compression with a 20 MB (20,000,000-byte) default target.",
  limitTitle: "Discord file size limit in 2026",
  limitDescription:
    "Discord's free upload limit is 20 MB as of August 2026. Nitro Basic is 50 MB, Nitro is up to 1 GB, and server boosts raise the cap only inside that server.",
}
