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
      "No. Image compression decodes and re-encodes the file in your browser. MP4 video compression is separate and uploads the selected video for server-side processing.",
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
      "Shrinkcord uploads the MP4 to storage and processes it in a server-side job. The input limit is 524,288,000 bytes (500 MiB), and the default target is 20 MB (20,000,000 bytes). Video files use temporary storage. Output availability can expire, and Shrinkcord does not promise a fixed retention period here.",
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
