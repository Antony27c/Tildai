import { ImageResponse } from "next/og";

export const alt = "Tildai — cada cobro, tildado";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 96px",
          background: "#F3F4F1",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <span style={{ fontSize: 132, fontWeight: 800, letterSpacing: "-0.03em", color: "#201C14" }}>
            tildai
          </span>
          <svg width="96" height="96" viewBox="0 0 16 16">
            <path
              d="M3 8.5 6.5 12 13 4.5"
              fill="none"
              stroke="#0E7A3D"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span style={{ fontSize: 54, color: "#5F6158", marginTop: 32 }}>Cada cobro, tildado.</span>
      </div>
    ),
    size
  );
}
