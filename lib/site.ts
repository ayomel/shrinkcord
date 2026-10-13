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
  title: "Shrink images for Discord's 20 MB limit | Shrinkcord",
  description:
    "Images over 20 MB shrink to 19.5 MB or less in your browser for Discord's free upload limit. JPEG, PNG, and WebP. Nothing is uploaded.",
  limitTitle: "Discord file size limit in 2026",
  limitDescription:
    "Discord's free upload limit is 20 MB as of August 2026. Nitro Basic is 50 MB, Nitro is up to 1 GB, and server boosts raise the cap only inside that server.",
}
