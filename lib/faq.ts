export const faqs = [
  {
    id: "why-19-5",
    question: "Why 19.5 MB instead of 20?",
    answer:
      "Discord’s free upload limit is 20 MB. The developer changelog counts that as 20 MiB (20 × 1024 × 1024 bytes). Shrinkcord stops at 19.5 MiB so a file near the line still clears the check.",
  },
  {
    id: "upload",
    question: "Does Shrinkcord upload my image?",
    answer:
      "No. The file is decoded and re-encoded in this tab. It is not sent to a server, and nothing is stored.",
  },
  {
    id: "formats",
    question: "Which image formats work?",
    answer:
      "JPEG, PNG, and WebP. GIF, HEIC, and video get an error instead of a quiet conversion.",
  },
  {
    id: "png",
    question: "What happens to a PNG?",
    answer:
      "PNG is lossless, so a quality slider cannot shrink it. Opaque PNGs become JPEG. PNGs with transparency first try a WebP that keeps the alpha. If that is still too large, the image is flattened onto white and saved as JPEG, and the row says so.",
  },
  {
    id: "already-small",
    question: "What if the image is already under 20 MB?",
    answer:
      "It is not modified. You can download the same file you dropped.",
  },
  {
    id: "still-rejected",
    question: "Will Discord still reject the file?",
    answer:
      "Discord checks the file size before its own compression. A result at or under 19.5 MiB is under the free 20 MiB cap. Nitro and server boosts allow larger files. This tool targets the free limit.",
  },
] as const
