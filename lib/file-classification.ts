export type FileKind = "image" | "video" | "unsupported"

export type ClassifiedFile = {
  kind: FileKind
  mime: string | null
}

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"])
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"])

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"])
const VIDEO_EXTENSIONS = new Set(["mp4", "mov"])

export function classifyByMimeAndName(file: Pick<File, "type" | "name">): FileKind {
  const type = file.type.trim().toLowerCase()
  if (IMAGE_MIMES.has(type)) return "image"
  if (VIDEO_MIMES.has(type)) return "video"

  const ext = file.name.split(".").pop()?.toLowerCase()
  if (ext && IMAGE_EXTENSIONS.has(ext)) return "image"
  if (ext && VIDEO_EXTENSIONS.has(ext)) return "video"
  return "unsupported"
}

function bytesMatch(head: Uint8Array, offset: number, signature: number[]): boolean {
  if (head.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    if (head[offset + i] !== signature[i]) return false
  }
  return true
}

/** Pure magic-byte sniff for the first bytes of a file. */
export function classifyByMagicBytes(head: Uint8Array): FileKind {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image"
  }
  if (head.length >= 8 && bytesMatch(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image"
  }
  if (head.length >= 12 && bytesMatch(head, 0, [0x52, 0x49, 0x46, 0x46]) && bytesMatch(head, 8, [0x57, 0x45, 0x42, 0x50])) {
    return "image"
  }
  if (head.length >= 12 && bytesMatch(head, 4, [0x66, 0x74, 0x79, 0x70])) {
    return "video"
  }
  return "unsupported"
}

export function classifyFile(
  file: Pick<File, "type" | "name">,
  headBytes?: Uint8Array,
): ClassifiedFile {
  const fromMeta = classifyByMimeAndName(file)
  if (fromMeta !== "unsupported") {
    return { kind: fromMeta, mime: file.type || null }
  }
  if (headBytes && headBytes.length > 0) {
    const fromMagic = classifyByMagicBytes(headBytes)
    if (fromMagic !== "unsupported") return { kind: fromMagic, mime: file.type || null }
  }
  return { kind: "unsupported", mime: file.type || null }
}

export async function readFileHead(file: File, byteCount = 16): Promise<Uint8Array> {
  const buffer = await file.slice(0, byteCount).arrayBuffer()
  return new Uint8Array(buffer)
}

export async function classifyFileAsync(file: File): Promise<ClassifiedFile> {
  const head = await readFileHead(file)
  return classifyFile(file, head)
}
