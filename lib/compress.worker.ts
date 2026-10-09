import { compressFile, type ShrinkResult } from "@/lib/compress"

type ProgressMessage = { type: "progress"; progress: number }
type DoneMessage = { type: "done"; result: ShrinkResult }
type ErrorMessage = { type: "error"; message: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ file: File }>) => void) | null
  postMessage: (message: ProgressMessage | DoneMessage | ErrorMessage) => void
}

scope.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const result = await compressFile(event.data.file, (progress) => {
      scope.postMessage({ type: "progress", progress })
    })
    scope.postMessage({ type: "done", result })
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Could not shrink this image.",
    })
  }
}
