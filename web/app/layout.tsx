import type { ReactNode } from "react";

export const metadata = { title: "Tildai - cada cobro, tildado" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f7f9", color: "#111" }}>
        {children}
      </body>
    </html>
  );
}
