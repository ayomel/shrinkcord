import { zipSync } from "fflate"

import { getVideoOutputFileName } from "@/lib/video/videoJobOutput"
import type { QueueItem } from "./types"

export const MAX_DOWNLOAD_ALL_BYTES = 500 * 1024 * 1024

export type DownloadAllErrorCode = "aborted" | "fetch" | "http" | "too-large"

export class DownloadAllError extends Error {
  constructor(
    readonly code: DownloadAllErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "DownloadAllError"
  }
}

function abortError() {
  return new DownloadAllError("aborted", "Archive download was canceled.")
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

async function readResponseBytes(
  response: Response,
  remainingBytes: number,
  name: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const advertisedLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(advertisedLength) && advertisedLength >= 0 && advertisedLength > remainingBytes) {
    void response.body?.cancel().catch(() => {})
    throw new DownloadAllError(
      "too-large",
      `Archive inputs exceed the 500 MiB limit at ${name}.`,
    )
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    assertNotAborted(signal)
    if (buffer.byteLength > remainingBytes) {
      throw new DownloadAllError("too-large", `Archive inputs exceed the 500 MiB limit at ${name}.`)
    }
    return new Uint8Array(buffer)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      assertNotAborted(signal)
      const { done, value } = await reader.read()
      assertNotAborted(signal)
      if (done) break
      size += value.byteLength
      if (size > remainingBytes) {
        void reader.cancel().catch(() => {})
        throw new DownloadAllError("too-large", `Archive inputs exceed the 500 MiB limit at ${name}.`)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof DownloadAllError) {
      if (error.code === "aborted") void reader.cancel().catch(() => {})
      throw error
    }
    if (signal?.aborted) throw abortError()
    throw new DownloadAllError("fetch", `Could not download ${name} for the archive.`)
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

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

export async function downloadAll(
  downloadable: QueueItem[],
  options: { signal?: AbortSignal } = {},
) {
  if (downloadable.length === 0) return
  const entries: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()
  let totalBytes = 0

  for (const item of downloadable) {
    assertNotAborted(options.signal)
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
    let response: Response
    try {
      response = await fetch(item.downloadUrl!, { signal: options.signal })
    } catch {
      if (options.signal?.aborted) throw abortError()
      throw new DownloadAllError("fetch", `Could not download ${name} for the archive.`)
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw new DownloadAllError("http", `Could not download ${name} for the archive (HTTP ${response.status}).`)
    }
    const buffer = await readResponseBytes(
      response,
      MAX_DOWNLOAD_ALL_BYTES - totalBytes,
      name,
      options.signal,
    )
    totalBytes += buffer.byteLength
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
