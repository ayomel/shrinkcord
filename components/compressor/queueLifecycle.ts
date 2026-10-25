import type { MutableRefObject } from "react"

import type { QueueItem } from "./types"

export type QueueLifecycle = {
  capture: () => number
  isCurrent: (generation: number) => boolean
  isAlive: () => boolean
  invalidate: () => void
  activate: () => void
  dispose: () => void
}

export function createQueueLifecycle(): QueueLifecycle {
  let generation = 0
  let alive = true

  return {
    capture: () => generation,
    isCurrent: (capturedGeneration) => alive && capturedGeneration === generation,
    isAlive: () => alive,
    invalidate: () => {
      generation += 1
    },
    activate: () => {
      if (alive) return
      alive = true
      generation += 1
    },
    dispose: () => {
      generation += 1
      alive = false
    },
  }
}

export function commitQueueItems(
  itemsRef: MutableRefObject<QueueItem[]>,
  setItems: (items: QueueItem[]) => void,
  additions: QueueItem[],
  startWork: () => void,
) {
  if (additions.length === 0) return

  itemsRef.current = [...itemsRef.current, ...additions]
  setItems([...itemsRef.current])
  startWork()
}

export async function classifyQueueFiles<FileInput, Classification>(
  files: FileInput[],
  classify: (file: FileInput) => Promise<Classification>,
  isCurrent: () => boolean,
): Promise<{ results: Array<{ file: FileInput; classification: Classification }>; failed: FileInput[] }> {
  const results: Array<{ file: FileInput; classification: Classification }> = []
  const failed: FileInput[] = []

  for (const file of files) {
    if (!isCurrent()) break
    try {
      const classification = await classify(file)
      if (!isCurrent()) break
      results.push({ file, classification })
    } catch {
      if (!isCurrent()) break
      failed.push(file)
    }
  }

  return { results, failed }
}
