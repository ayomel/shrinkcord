import type { MutableRefObject } from "react"

function videoThumbLabel(file: File): string {
  if (file.type === "video/quicktime" || /\.mov$/i.test(file.name)) return "MOV"
  return "MP4"
}

export function ResultThumb({ url, name, file }: { url?: string; name: string; file: File }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- object URL preview
      <img
        src={url}
        alt=""
        className="size-11 shrink-0 rounded-lg object-cover"
        title={name}
      />
    )
  }
  if (file.type.startsWith("video/") || /\.(mp4|mov)$/i.test(file.name)) {
    return (
      <div
        className="size-11 shrink-0 rounded-lg bg-[#1a1c22] grid place-items-center text-[10px] font-semibold uppercase text-muted-foreground"
        aria-hidden="true"
      >
        {videoThumbLabel(file)}
      </div>
    )
  }
  return (
    <div
      className="size-11 shrink-0 rounded-lg bg-[linear-gradient(135deg,#7a5cff,#2bb3a3_60%,#f2b84b)]"
      aria-hidden="true"
    />
  )
}

export async function makeThumbUrl(file: File): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 88, resizeQuality: "low" })
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (!context) {
      bitmap.close()
      return undefined
    }
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.72)
    })
    if (!blob) return undefined
    return URL.createObjectURL(blob)
  } catch {
    return undefined
  }
}

export function revokeTracked(urls: MutableRefObject<string[]>, url?: string) {
  if (!url) return
  URL.revokeObjectURL(url)
  urls.current = urls.current.filter((entry) => entry !== url)
}
