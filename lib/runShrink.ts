import { compressFile, type ShrinkResult } from "@/lib/compress"

type WorkerMessage =
  | { type: "progress"; progress: number }
  | { type: "done"; result: ShrinkResult }
  | { type: "error"; message: string }

export type RunShrinkDeps = {
  compress?: typeof compressFile
  /** Return a Worker, or null/throw to force the main-thread path. */
  openWorker?: () => Worker
}

export function runShrink(
  file: File,
  onProgress?: (progress: number) => void,
  deps: RunShrinkDeps = {},
) {
  const compress = deps.compress ?? compressFile

  return new Promise<ShrinkResult>((resolve, reject) => {
    const openWorker =
      deps.openWorker ??
      (() => {
        if (typeof Worker === "undefined") {
          throw new Error("Worker unavailable")
        }
        return new Worker(new URL("./compressWorker.ts", import.meta.url), {
          type: "module",
        })
      })

    let worker: Worker
    try {
      worker = openWorker()
    } catch {
      compress(file, onProgress).then(resolve, reject)
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
          compress(file, onProgress).then(resolve, reject)
        })
      }
    }

    worker.onerror = () => {
      finish(() => {
        compress(file, onProgress).then(resolve, reject)
      })
    }

    worker.postMessage({ file })
  })
}
