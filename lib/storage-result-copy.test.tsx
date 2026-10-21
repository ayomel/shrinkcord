import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { StorageResultNote } from "../components/storage-result-note"
import {
  STORAGE_ALREADY_FITS_NOTE,
  STORAGE_NOT_SAVED_NOTE,
  buildStorageResultPresentation,
} from "./storage-result-copy"

describe("buildStorageResultPresentation", () => {
  it("derives availability text from expires_at", () => {
    const view = buildStorageResultPresentation({
      storageDownloadUrl: "https://cdn.test/file.jpg",
      storageExpiresAt: "2026-10-28T12:00:00.000Z",
    })
    assert.equal(view?.kind, "saved")
    if (view?.kind === "saved") {
      assert.match(view.availabilityLabel, /Available for \d+ days/)
    }
  })

  it("shows the passthrough note without a storage link", () => {
    const view = buildStorageResultPresentation({ storagePassthrough: true })
    assert.equal(view?.kind, "not_saved")
    if (view?.kind === "not_saved") {
      assert.equal(view.note, STORAGE_ALREADY_FITS_NOTE)
    }
  })

  it("shows the not-saved note when storage failed or was skipped", () => {
    const view = buildStorageResultPresentation({ storageNotSaved: true })
    assert.equal(view?.kind, "not_saved")
    if (view?.kind === "not_saved") {
      assert.equal(view.note, STORAGE_NOT_SAVED_NOTE)
    }
  })

  it("prefers a saved link over a not-saved flag", () => {
    const view = buildStorageResultPresentation({
      storageDownloadUrl: "https://cdn.test/file.jpg",
      storageExpiresAt: "2026-10-28T12:00:00.000Z",
      storageNotSaved: true,
    })
    assert.equal(view?.kind, "saved")
  })
})

describe("StorageResultNote", () => {
  it("renders derived availability next to the storage link", () => {
    const html = renderToStaticMarkup(
      <StorageResultNote
        storageDownloadUrl="https://cdn.test/out.jpg"
        storageExpiresAt="2026-10-28T12:00:00.000Z"
      />,
    )
    assert.match(html, /Storage download link/)
    assert.match(html, /Available for/)
  })

  it("renders the not-saved fallback copy", () => {
    const html = renderToStaticMarkup(<StorageResultNote storageNotSaved />)
    assert.match(html, /Not saved online/)
  })

  it("renders the already-fits note", () => {
    const html = renderToStaticMarkup(<StorageResultNote storagePassthrough />)
    assert.match(html, /Already fits, not saved online/)
  })
})
