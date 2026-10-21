export const faqs = [
  {
    id: "why-19-5",
    question: "Why 19.5 MB instead of 20?",
    answer:
      "Discord's free upload limit is 20 MB. The developer changelog counts that as 20 MiB (20 × 1024 × 1024 bytes). Shrinkcord stops at 19.5 MiB so a file near the line still clears the check.",
  },
  {
    id: "upload",
    question: "Does Shrinkcord upload my image?",
    answer:
      "Images are compressed in your browser first. Only the compressed result is uploaded for a 7-day storage link when this site is connected to the Shrinkcord API. Your original image file is never stored. MP4 video compression uploads the selected video for server-side processing.",
  },
  {
    id: "formats",
    question: "Which image formats work?",
    answer:
      "Local image compression supports JPEG, PNG, and WebP. MP4 videos use the separate server-side compression tool. GIF and HEIC images are not supported.",
  },
  {
    id: "video",
    question: "What happens when I compress an MP4?",
    answer:
      "Shrinkcord uploads MP4 or MOV videos directly to the compression API and processes them in a server-side job. The input limit is 524,288,000 bytes (500 MiB) and 10 minutes when your browser can read duration metadata. The default target is 20 MB (20,000,000 bytes). Completed compressed outputs are stored for 7 days with a download link. Original uploads are not kept after processing.",
  },
  {
    id: "png",
    question: "What happens to a PNG?",
    answer:
      "PNG is lossless, so a quality slider cannot shrink it. Opaque PNGs become JPEG. PNGs with transparency try a WebP that keeps the alpha first. If that is still too large, the image is flattened onto white and saved as JPEG, and the row says so.",
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
