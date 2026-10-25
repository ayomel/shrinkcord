import { zipSync } from "fflate"

import { getVideoOutputFileName } from "@/lib/video/videoJobOutput"
import type { QueueItem } from "./types"

export function downloadOne(item: QueueItem) {
  if (!item.downloadUrl) return
  const anchor = document.createElement("a")
  anchor.href = item.downloadUrl
  if (item.kind === "image" && item.result) {
    anchor.download = item.result.fileName
  } else if (item.kind === "video") {
    anchor.download = getVideoOutputFileName(item.file.name)
  }
  anchor.click()
}

export async function downloadAll(downloadable: QueueItem[]) {
  if (downloadable.length === 0) return
  const entries: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()

  for (const item of downloadable) {
    const buffer = new Uint8Array(await (await fetch(item.downloadUrl!)).arrayBuffer())
    let name: string
    if (item.kind === "image" && item.result) {
      name = item.result.fileName
    } else if (item.kind === "video") {
      name = getVideoOutputFileName(item.file.name)
    } else {
      continue
    }
    if (usedNames.has(name)) {
      const stem = name.replace(/(\.[^.]+)?$/, "")
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
      let n = 2
      while (usedNames.has(`${stem}-${n}${ext}`)) n += 1
      name = `${stem}-${n}${ext}`
    }
    usedNames.add(name)
    entries[name] = buffer
  }

  const zipped = zipSync(entries, { level: 0 })
  const blob = new Blob([zipped], { type: "application/zip" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "shrinkcord-discord.zip"
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
