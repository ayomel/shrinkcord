import { cancelShrinkcordJob } from "@/lib/api/shrinkcordApiClient"

/** Best-effort DELETE; 409 means the job already finished. */
export async function requestServerJobCancel(jobId: string): Promise<void> {
  try {
    await cancelShrinkcordJob(jobId)
  } catch {
    // Cleanup is best-effort when removing from the UI.
  }
}
