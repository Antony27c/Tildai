import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const base = process.env.NEXT_PUBLIC_BASE_URL;
let metadataBase: URL | undefined;
try {
  metadataBase = base ? new URL(base) : undefined;
} catch {
  metadataBase = undefined;
}

const title = "Tildai · cada cobro, tildado";
const description =
  "Tildai atiende la caja de tu comercio: cobrás con un QR en pesos, te avisa cada venta por Telegram y ordena la plata del día. La plata es siempre tuya.";

export const metadata: Metadata = {
  metadataBase,
  title: { default: title, template: "%s · Tildai" },
  description,
  openGraph: {
    title,
    description,
    siteName: "Tildai",
    locale: "es_AR",
    type: "website",
  },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E7A3D",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
