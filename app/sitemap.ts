import { site } from "@/lib/site"
import type { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: site.url,
      lastModified: new Date("2026-10-09"),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${site.url}/discord-file-limit`,
      lastModified: new Date("2026-10-09"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ]
}
