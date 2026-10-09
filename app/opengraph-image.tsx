import { ImageResponse } from "next/og"

export const alt = "Shrinkcord shrinks images over 20 MB to 19.5 MB for Discord"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background: "#1E1F22",
          color: "#DBDEE1",
          padding: "72px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 22,
            letterSpacing: 3,
            color: "#5865F2",
          }}
        >
          SHRINKCORD
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              letterSpacing: -2,
              lineHeight: 0.95,
              color: "#FFFFFF",
            }}
          >
            Shrink images Discord will take.
          </div>
          <div style={{ marginTop: 28, fontSize: 28, color: "#949BA4" }}>
            Over 20 MB down to 19.5 MB. In the browser.
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
