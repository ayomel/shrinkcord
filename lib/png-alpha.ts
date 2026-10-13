const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const

/** Color types that always include an alpha channel. */
const ALPHA_COLOR_TYPES = new Set([4, 6])

/**
 * Fast path: inspect PNG chunks for an alpha-capable color type (4/6)
 * or a tRNS chunk. Returns false for non-PNG buffers.
 */
export function pngHeaderSuggestsAlpha(bytes: Uint8Array): boolean {
  if (bytes.length < 33) return false
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false
  }

  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length =
      (bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    )
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) break

    if (type === "IHDR" && length >= 13) {
      const colorType = bytes[dataStart + 9]!
      if (ALPHA_COLOR_TYPES.has(colorType)) return true
    }

    if (type === "tRNS" && length > 0) return true
    if (type === "IDAT" || type === "IEND") break

    offset = dataEnd + 4
  }

  return false
}

/**
 * Scan decoded pixels in horizontal strips; early-exit on any alpha < 255.
 */
export async function bitmapHasTransparentPixels(
  bitmap: ImageBitmap,
  stripHeight = 64,
): Promise<boolean> {
  const width = bitmap.width
  const height = bitmap.height
  if (width < 1 || height < 1) return false

  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, Math.min(stripHeight, height))
      : Object.assign(document.createElement("canvas"), {
          width,
          height: Math.min(stripHeight, height),
        })

  const context = canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) return false

  for (let y = 0; y < height; y += stripHeight) {
    const h = Math.min(stripHeight, height - y)
    if ("height" in canvas) canvas.height = h
    context.clearRect(0, 0, width, h)
    context.drawImage(bitmap, 0, y, width, h, 0, 0, width, h)
    const { data } = context.getImageData(0, 0, width, h)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 255) return true
    }
  }

  return false
}

export async function fileHasTransparency(
  file: File,
  bitmap: ImageBitmap,
): Promise<boolean> {
  if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
    return false
  }

  const headerBytes = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer())
  if (!pngHeaderSuggestsAlpha(headerBytes)) return false
  return bitmapHasTransparentPixels(bitmap)
}
