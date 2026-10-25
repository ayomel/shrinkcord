const chains = new Map<string, Promise<unknown>>()

/** Run storage saves for the same output filename one at a time. */
export function enqueueStorageSaveByFileName<T>(fileName: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(fileName) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => task())
  chains.set(fileName, next)
  void next.finally(() => {
    if (chains.get(fileName) === next) chains.delete(fileName)
  })
  return next
}

/** @internal Test-only reset. */
export function resetStorageSaveQueuesForTests(): void {
  chains.clear()
}
