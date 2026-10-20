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
          <svg width="168" height="168" viewBox="0 0 512 512">
            <rect width="512" height="512" rx="116" fill="#0E7A3D" />
            <path
              fill="#FFFFFF"
              d="M124 104 146 84 168 104 190 84 212 104 234 84 256 104 278 84 300 104 322 84 344 104 366 84 388 104 388 408 366 428 344 408 322 428 300 408 278 428 256 408 234 428 212 408 190 428 168 408 146 428 124 408Z"
            />
            <path
              d="M196 256 238 298 316 208"
              fill="none"
              stroke="#0E7A3D"
              strokeWidth="31"
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
