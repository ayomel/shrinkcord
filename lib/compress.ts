import {
  DISCORD_FREE_LIMIT_BYTES,
  MAX_QUALITY,
  MIN_QUALITY,
  MIN_SHORT_EDGE,
  SCALE_STEP,
  TARGET_BYTES,
  acceptedType,
  outputFileName,
  type AcceptedType,
} from "@/lib/limits"

export type ShrinkResult = {
  blob: Blob
  fileName: string
  outputType: string
  convertedFromPng: boolean
  passthrough: boolean
  scaled: boolean
  missedTarget: boolean
  originalBytes: number
  outputBytes: number
  width: number
  height: number
}

type EncodeType = "image/jpeg" | "image/webp"

function yieldToMain() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function canvasBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: EncodeType,
  quality: number,
) {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality })
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
  if (!blob) throw new Error("Could not encode this image.")
  return blob
}

async function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: EncodeType,
  quality: number,
) {
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height })

  const context = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) throw new Error("Could not prepare this image.")

  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  return canvasBlob(canvas, type, quality)
}

async function searchQuality(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: EncodeType,
  targetBytes: number,
  report: (step: number) => void,
) {
  let low = MIN_QUALITY
  let high = MAX_QUALITY
  let bestFit: Blob | null = null
  let smallest: Blob | null = null

  for (let step = 0; step < 7; step += 1) {
    const quality = (low + high) / 2
    const blob = await encode(bitmap, width, height, type, quality)
    report(1)
    if (!smallest || blob.size < smallest.size) smallest = blob
    if (blob.size <= targetBytes) {
      bestFit = blob
      low = quality
    } else {
      high = quality
    }
    await yieldToMain()
  }

  if (!bestFit) {
    const floor = await encode(bitmap, width, height, type, MIN_QUALITY)
    report(1)
    if (!smallest || floor.size < smallest.size) smallest = floor
    if (floor.size <= targetBytes) bestFit = floor
  }

  return { bestFit, smallest }
}

export async function compressFile(
  file: File,
  onProgress?: (progress: number) => void,
  targetBytes = TARGET_BYTES,
): Promise<ShrinkResult> {
  const inputType = acceptedType(file)
  if (!inputType) {
    throw new Error("Use a JPEG, PNG, or WebP.")
  }

  if (file.size <= DISCORD_FREE_LIMIT_BYTES) {
    onProgress?.(100)
    return {
      blob: file,
      fileName: outputFileName(file.name, file.type, true),
      outputType: inputType,
      convertedFromPng: false,
      passthrough: true,
      scaled: false,
      missedTarget: false,
      originalBytes: file.size,
      outputBytes: file.size,
      width: 0,
      height: 0,
    }
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  let outputType: EncodeType = inputType === "image/webp" ? "image/webp" : "image/jpeg"
  const convertedFromPng = inputType === "image/png"
  let steps = 0
  const report = () => {
    steps += 1
    onProgress?.(Math.min(95, Math.round((steps / 40) * 100)))
  }

  try {
    let scale = 1
    let scaled = false
    let best: { blob: Blob; width: number; height: number } | null = null

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const shortEdge = Math.min(width, height)

      let search
      try {
        search = await searchQuality(bitmap, width, height, outputType, targetBytes, report)
      } catch (error) {
        if (outputType !== "image/webp") throw error
        outputType = "image/jpeg"
        search = await searchQuality(bitmap, width, height, outputType, targetBytes, report)
      }

      const candidate = search.bestFit ?? search.smallest
      if (candidate && (!best || candidate.size < best.blob.size)) {
        best = { blob: candidate, width, height }
      }

      if (search.bestFit) {
        onProgress?.(100)
        return {
          blob: search.bestFit,
          fileName: outputFileName(file.name, outputType, false),
          outputType,
          convertedFromPng,
          passthrough: false,
          scaled,
          missedTarget: false,
          originalBytes: file.size,
          outputBytes: search.bestFit.size,
          width,
          height,
        }
      }

      if (shortEdge <= MIN_SHORT_EDGE) break

      const nextScale = scale * SCALE_STEP
      const nextShort = Math.min(bitmap.width, bitmap.height) * nextScale
      if (nextShort < MIN_SHORT_EDGE) {
        const clamped = MIN_SHORT_EDGE / Math.min(bitmap.width, bitmap.height)
        if (clamped >= scale - 0.001) break
        scale = clamped
      } else {
        scale = nextScale
      }
      scaled = true
    }

    if (!best) throw new Error("Could not shrink this image.")

    onProgress?.(100)
    return {
      blob: best.blob,
      fileName: outputFileName(file.name, outputType, false),
      outputType,
      convertedFromPng,
      passthrough: false,
      scaled,
      missedTarget: best.blob.size > targetBytes,
      originalBytes: file.size,
      outputBytes: best.blob.size,
      width: best.width,
      height: best.height,
    }
  } finally {
    bitmap.close()
  }
}

export function typeLabel(type: AcceptedType | string) {
  if (type === "image/png") return "PNG"
  if (type === "image/webp") return "WebP"
  return "JPEG"
}
