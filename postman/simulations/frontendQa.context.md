# Frontend QA simulation

Run from the repository root with Postman CLI 1.70 or newer. No Postman login or cloud workspace is required. The CLI session used for QA was signed out, so owner-mock discovery was skipped. This local mock follows the client contracts in `lib/api/shrinkcordApiClient.ts` and `lib/storage/shrinkcordStorageUpload.ts`.

```powershell
postman simulation run postman/simulations/frontendQa.sim.yaml --port 5190 --no-history
```

In another terminal:

```powershell
$env:NEXT_PUBLIC_SHRINKCORD_API_URL = 'http://localhost:5190/api'
$env:SHRINKCORD_API_URL = 'http://localhost:5190/api'
node node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port 5191
```

Open `http://localhost:5191`. Generate synthetic media with `powershell -File scripts/createQaFixtures.ps1`; FFmpeg must be installed. Fixture paths are printed by that script.

Select a scenario before adding a video:

```powershell
Invoke-RestMethod 'http://localhost:5190/api/qa/reset?mode=success'
```

Available modes are `success`, `cancel`, `failed`, `busy`, `busy-exhausted`, `expired`, and `download-failed`. Clear the browser queue before resetting the mock, since reset clears server-side test jobs. `cancel` keeps jobs processing until canceled; `busy-exhausted` returns 429 until the mode changes. Switch to `success` before clicking Retry to test recovery.

`GET /api/qa/requests` returns the request paths and origins for the current scenario. A successful video must fetch `/objects/...mp4?signature=keep%2Bexact` directly with the frontend origin. The `/jobs/:id/file` route deliberately fails so regressions cannot pass through a redirect.

The mock streams and drains uploads without request-body interception; it does not need decoded request bodies or session isolation. This avoids buffering binary media in the mock framework. It implements only the paths used by frontend QA and returns 501 elsewhere. Video output is a small synthetic binary fixture, not a real transcode. Passing against this mock establishes frontend behavior, not live FFmpeg, R2 signing, production retention, or bucket CORS. No cloud mock is published or deployed.
