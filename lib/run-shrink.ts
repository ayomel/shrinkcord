import { compressFile, type ShrinkResult } from "@/lib/compress"

type WorkerMessage =
  | { type: "progress"; progress: number }
  | { type: "done"; result: ShrinkResult }
  | { type: "error"; message: string }

export function runShrink(file: File, onProgress?: (progress: number) => void) {
  return new Promise<ShrinkResult>((resolve, reject) => {
    if (typeof Worker === "undefined") {
      compressFile(file, onProgress).then(resolve, reject)
      return
    }

    let worker: Worker
    try {
      worker = new Worker(new URL("./compress.worker.ts", import.meta.url), {
        type: "module",
      })
    } catch {
      compressFile(file, onProgress).then(resolve, reject)
      return
    }

    let settled = false
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      worker.terminate()
      run()
    }

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data
      if (!data) return
      if (data.type === "progress") onProgress?.(data.progress)
      if (data.type === "done") finish(() => resolve(data.result))
      if (data.type === "error") {
        finish(() => {
          compressFile(file, onProgress).then(resolve, reject)
        })
      }
    }

    worker.onerror = () => {
      finish(() => {
        compressFile(file, onProgress).then(resolve, reject)
      })
    }

    worker.postMessage({ file })
  })
}
