import { headers } from "next/headers";
import { isAddress } from "viem";
import { QRCodeSVG } from "qrcode.react";
import AmountForm from "./AmountForm.tsx";
import { parseAmount } from "../lib/ripio.ts";

export default async function Page({ searchParams }: { searchParams: Promise<{ vault?: string; amount?: string }> }) {
  const { vault, amount } = await searchParams;
  if (!vault || !isAddress(vault)) {
    return <main style={{ padding: 24 }}>Este link de cobro no es válido. Pedile al comercio que te pase el QR de nuevo.</main>;
  }
  const h = await headers();
  const base = process.env.NEXT_PUBLIC_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const counterUrl = `${base}/?vault=${vault}`;
  const fixed = parseAmount(amount);
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24, display: "grid", gap: 24 }}>
      <h1 style={{ margin: 0 }}>Tildai ✓</h1>
      <AmountForm vault={vault} fixed={fixed} />
      <section style={{ textAlign: "center" }}>
        <p>QR del mostrador</p>
        <QRCodeSVG value={counterUrl} size={200} />
      </section>
    </main>
  );
}
