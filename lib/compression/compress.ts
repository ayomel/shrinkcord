import {
  DISCORD_FREE_LIMIT_BYTES,
  MAX_QUALITY,
  MIN_QUALITY,
  MIN_SHORT_EDGE,
  MIN_TRANSPARENT_WEBP_QUALITY,
  QUALITY_SEARCH_MAX_STEPS,
  QUALITY_TARGET_TOLERANCE,
  TARGET_BYTES,
  acceptedType,
  outputFileName,
  type AcceptedType,
} from "@/lib/compression/limits"
import { preferTransparentWebp } from "@/lib/compression/outputStrategy"
import { fileHasTransparency } from "@/lib/compression/pngAlpha"
import { scaleForTarget, searchQualityBySize } from "@/lib/compression/searchQuality"

export type ShrinkResult = {
  blob: Blob
  fileName: string
  outputType: string
  convertedFromPng: boolean
  flattenedTransparency: boolean
  passthrough: boolean
  scaled: boolean
  missedTarget: boolean
  originalBytes: number
  outputBytes: number
  width: number
  height: number
}

type EncodeType = "image/jpeg" | "image/webp"

export type ScalePassResult = {
  candidate: { blob: Blob; width: number; height: number; size: number } | null
  scaled: boolean
  missedTarget: boolean
}

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
  flatten: boolean,
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

  if (flatten || type === "image/jpeg") {
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, width, height)
  } else {
    context.clearRect(0, 0, width, height)
  }
  context.drawImage(bitmap, 0, 0, width, height)
  return canvasBlob(canvas, type, quality)
}

function clampScaleToMinShortEdge(bitmap: ImageBitmap, scale: number) {
  const shortEdge = Math.min(bitmap.width, bitmap.height)
  const minScale = MIN_SHORT_EDGE / shortEdge
  if (shortEdge * scale < MIN_SHORT_EDGE) {
    return Math.min(1, Math.max(minScale, scale))
  }
  return Math.min(1, scale)
}

async function searchAtScale(
  bitmap: ImageBitmap,
  scale: number,
  type: EncodeType,
  flatten: boolean,
  targetBytes: number,
  report: () => void,
  minQuality: number,
) {
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const search = await searchQualityBySize(
    async (quality) => {
      const blob = await encode(bitmap, width, height, type, quality, flatten)
      await yieldToMain()
      return { size: blob.size, quality, blob }
    },
    targetBytes,
    {
      minQuality,
      maxQuality: MAX_QUALITY,
      maxSteps: QUALITY_SEARCH_MAX_STEPS,
      tolerance: QUALITY_TARGET_TOLERANCE,
      onEncode: report,
    },
  )

  return {
    width,
    height,
    bestFit: search.bestFit?.blob
      ? { blob: search.bestFit.blob, width, height, size: search.bestFit.size }
      : null,
    smallest: search.smallest?.blob
      ? { blob: search.smallest.blob, width, height, size: search.smallest.size }
      : null,
    encodes: search.encodes,
  }
}

export async function shrinkWithScalePasses(
  bitmap: ImageBitmap,
  type: EncodeType,
  flatten: boolean,
  targetBytes: number,
  report: () => void,
  options?: { minQuality?: number },
): Promise<ScalePassResult> {
  const minQuality = options?.minQuality ?? MIN_QUALITY
  let scaled = false
  let best: { blob: Blob; width: number; height: number; size: number } | null = null

  const first = await searchAtScale(
    bitmap,
    1,
    type,
    flatten,
    targetBytes,
    report,
    minQuality,
  )
  if (first.bestFit) {
    return { candidate: first.bestFit, scaled: false, missedTarget: false }
  }
  if (first.smallest) best = first.smallest

  const shortEdge = Math.min(bitmap.width, bitmap.height)
  if (shortEdge <= MIN_SHORT_EDGE || !first.smallest) {
    return {
      candidate: best,
      scaled: false,
      missedTarget: !best || best.size > targetBytes,
    }
  }

  let scale = clampScaleToMinShortEdge(
    bitmap,
    scaleForTarget(targetBytes, first.smallest.size),
  )
  if (scale >= 0.999) {
    return {
      candidate: best,
      scaled: false,
      missedTarget: !best || best.size > targetBytes,
    }
  }
  scaled = true

  const second = await searchAtScale(
    bitmap,
    scale,
    type,
    flatten,
    targetBytes,
    report,
    minQuality,
  )
  if (second.bestFit) {
    return { candidate: second.bestFit, scaled: true, missedTarget: false }
  }
  if (second.smallest && (!best || second.smallest.size < best.size)) {
    best = second.smallest
  }

  // One corrective pass if still over target.
  if (second.smallest && second.smallest.size > targetBytes) {
    const corrected = clampScaleToMinShortEdge(
      bitmap,
      scale * scaleForTarget(targetBytes, second.smallest.size),
    )
    if (
      corrected < scale - 0.001 &&
      Math.min(bitmap.width, bitmap.height) * corrected >= MIN_SHORT_EDGE - 0.5
    ) {
      scale = corrected
      const third = await searchAtScale(
        bitmap,
        scale,
        type,
        flatten,
        targetBytes,
        report,
        minQuality,
      )
      if (third.bestFit) {
        return { candidate: third.bestFit, scaled: true, missedTarget: false }
      }
      if (third.smallest && (!best || third.smallest.size < best.size)) {
        best = third.smallest
      }
    }
  }

  return {
    candidate: best,
    scaled,
    missedTarget: !best || best.size > targetBytes,
  }
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
      flattenedTransparency: false,
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
  const hasTransparency =
    inputType === "image/png" ? await fileHasTransparency(file, bitmap) : false

  let encodes = 0
  // Transparent PNGs get a full WebP scale-pass budget before JPEG flatten passes.
  const passBudget = 1 + QUALITY_SEARCH_MAX_STEPS
  const encodeBudget = (hasTransparency ? passBudget * 3 : 0) + passBudget * 3
  const report = () => {
    encodes += 1
    onProgress?.(Math.min(95, Math.round((encodes / encodeBudget) * 100)))
  }

  try {
    // Transparent PNGs: keep alpha via WebP (including scaled passes) before JPEG flatten.
    if (hasTransparency) {
      try {
        const webp = await shrinkWithScalePasses(
          bitmap,
          "image/webp",
          false,
          targetBytes,
          report,
          { minQuality: MIN_TRANSPARENT_WEBP_QUALITY },
        )
        if (preferTransparentWebp(webp) && webp.candidate) {
          onProgress?.(100)
          return {
            blob: webp.candidate.blob,
            fileName: outputFileName(file.name, "image/webp", false),
            outputType: "image/webp",
            convertedFromPng: false,
            flattenedTransparency: false,
            passthrough: false,
            scaled: webp.scaled,
            missedTarget: false,
            originalBytes: file.size,
            outputBytes: webp.candidate.size,
            width: webp.candidate.width,
            height: webp.candidate.height,
          }
        }
      } catch {
        // Fall through to JPEG flatten if WebP encode is unavailable.
      }
    }

    let outputType: EncodeType = inputType === "image/webp" ? "image/webp" : "image/jpeg"
    const flatten = hasTransparency || inputType === "image/png"
    const convertedFromPng = inputType === "image/png"
    const flattenedTransparency = hasTransparency

    let result
    try {
      result = await shrinkWithScalePasses(
        bitmap,
        outputType,
        flatten || outputType === "image/jpeg",
        targetBytes,
        report,
      )
    } catch (error) {
      if (outputType !== "image/webp") throw error
      outputType = "image/jpeg"
      result = await shrinkWithScalePasses(bitmap, outputType, true, targetBytes, report)
    }

    if (!result.candidate) throw new Error("Could not shrink this image.")

    onProgress?.(100)
    return {
      blob: result.candidate.blob,
      fileName: outputFileName(file.name, outputType, false),
      outputType,
      convertedFromPng: convertedFromPng && outputType === "image/jpeg",
      flattenedTransparency: flattenedTransparency && outputType === "image/jpeg",
      passthrough: false,
      scaled: result.scaled,
      missedTarget: result.missedTarget,
      originalBytes: file.size,
      outputBytes: result.candidate.size,
      width: result.candidate.width,
      height: result.candidate.height,
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
