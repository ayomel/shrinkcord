# End-to-end QA record

Checked on 2026-10-25 from the merged main branch, with the fixes in this PR. No finite test pass proves every possible edge case; this record states the scenarios exercised and the remaining live-service boundary.

## Browser checks

The frontend ran in Chrome against the local Postman simulation documented in `postman/simulations/frontendQa.context.md`.

| Scenario | Observed result |
| --- | --- |
| Mixed PNG, MP4, empty PNG, unsupported text | Valid files completed independently; empty image showed an error; unsupported file showed the rejection message. |
| Noisy 22.73 MiB PNG | Browser compressed it to 11.31 MiB JPEG. |
| Uncompressed 25.83 MiB PNG | Browser compressed it to a 106,231-byte JPEG and completed the simulated storage save. |
| Local image download | Browser saved `compressible-discord.jpg`; FFprobe confirmed JPEG, 3000 by 3000 pixels, 106,231 bytes. |
| Mixed image/video ZIP | Browser saved the ZIP; inspection found `small.png` and `clip-discord.mp4`. The PNG matched the fixture byte for byte. Video bytes were the mock fixture, not a transcode. |
| Video success | Browser uploaded, polled, fetched the exact signed object URL directly, and showed Ready. Recorded object request Origin was the frontend origin; no job-file redirect endpoint was used. |
| Cancel during processing | The row stayed Canceled and the mock received cancellation. |
| Video longer than 10 minutes | Browser metadata precheck rejected it before upload. |
| Encoder failure | The row showed the server error and no Download action. |
| Repeated 429 responses | After the initial upload plus 12 retries, the row offered one Retry action. Restoring the backend and clicking Retry completed successfully. |
| Signed download returns 503 | The row showed a retryable error. |
| Signed download returns 403 | The row showed that output was unavailable, without a Retry or Download action. |
| Production API unset | Video intake was rejected while the image reached its unchanged result and download controls. The production browser console had no errors or warnings. |
| Clear all and remove | Rows and controls disappeared; new selections continued working. |

The first large-body storage check failed because the QA mock replied before draining the upload; fixing the mock resolved it. Early development hot reloads also invalidated existing blob URLs. A ZIP attempt exposed the old unhandled fetch failure; the new archive error, busy, cancellation, and size-limit handling is covered by regressions, and the final fresh-page ZIP download passed.

## Automated checks

The standard `pnpm test` command includes the new regression suites. It covers queue insertion before prechecks, stale classification after clear, unreadable files, unmount generation invalidation, video retry/error mapping, empty images, bitmap cleanup, worker startup fallback, signed URL fetching, output size caps before buffering, chunked overflow, blocked reads, caller abort, timeout, and cancellation implementations that never settle. Archive tests cover duplicate names, network and HTTP errors, abort, aggregate size limits, and ZIP contents.

The final suite passed 134 frontend tests and 17 PR-body tests, with zero failures.

Final verification commands:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm audit
```

Next.js and its ESLint configuration were patched to 16.4.1. The shadcn CLI is a development dependency and was updated within its current major version. The remaining audit overrides select fixed releases within their existing major versions. The final dependency audit reported no known vulnerabilities, and the shadcn CLI version command succeeded.

## Remaining acceptance boundary

The simulation proves frontend request handling and user states. Live FFmpeg compression, R2 signing, retention/deletion, production CORS, HEVC behavior across browsers, device memory limits, and Safari/Firefox were not verified. Those require the actual backend and browser/device acceptance checks. No R2 CORS policy, public access setting, production backend, or deployment was changed.
