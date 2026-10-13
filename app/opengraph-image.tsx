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
          background: "#18191c",
          color: "#eceef1",
          padding: "72px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 24,
            fontWeight: 700,
            color: "#eceef1",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#5865f2",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                border: "2.5px solid #ffffff",
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ display: "flex" }}>Shrinkcord</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1.05,
              color: "#ffffff",
              maxWidth: 920,
            }}
          >
            <div style={{ display: "flex" }}>Get any image under</div>
            <div style={{ display: "flex" }}>
              <span>Discord’s&nbsp;</span>
              <span style={{ color: "#949cf7" }}>20 MB</span>
              <span>&nbsp;limit.</span>
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 28, color: "#a3a9b2" }}>
            Over 20 MB down to 19.5 MB. In the browser. Nothing is uploaded.
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
