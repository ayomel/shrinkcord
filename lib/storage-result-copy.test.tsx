import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { StorageResultNote } from "../components/storage-result-note"
import {
  STORAGE_AVAILABLE_LABEL,
  STORAGE_NOT_SAVED_NOTE,
  buildStorageResultPresentation,
} from "./storage-result-copy"

describe("buildStorageResultPresentation", () => {
  it("shows the 7-day label when a storage URL is present", () => {
    const view = buildStorageResultPresentation({
      storageDownloadUrl: "https://cdn.test/file.jpg",
    })
    assert.equal(view?.kind, "saved")
    if (view?.kind === "saved") {
      assert.equal(view.availabilityLabel, STORAGE_AVAILABLE_LABEL)
      assert.match(view.downloadUrl, /cdn\.test/)
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
      storageNotSaved: true,
    })
    assert.equal(view?.kind, "saved")
  })
})

describe("StorageResultNote", () => {
  it("renders Available for 7 days next to the storage link", () => {
    const html = renderToStaticMarkup(
      <StorageResultNote storageDownloadUrl="https://cdn.test/out.jpg" />,
    )
    assert.match(html, /Storage download link/)
    assert.match(html, /Available for 7 days/)
  })

  it("renders the not-saved fallback copy", () => {
    const html = renderToStaticMarkup(<StorageResultNote storageNotSaved />)
    assert.match(html, /Not saved online/)
  })
})
