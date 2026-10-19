import { headers } from "next/headers";
import { QRCodeSVG } from "qrcode.react";
import AmountForm from "./AmountForm.tsx";
import { parseAmount } from "../lib/ripio.ts";
import { parseSale } from "../lib/sale.ts";
import { checkVault } from "../lib/vaults.ts";

export default async function Page({ searchParams }: { searchParams: Promise<{ vault?: string; amount?: string; sale?: string }> }) {
  const { vault, amount, sale } = await searchParams;
  const parsedSale = parseSale(sale);
  if (!parsedSale.ok) {
    return <main style={{ padding: 24 }}>Este link de cobro no es válido. Pedile al comercio que te pase el QR de nuevo.</main>;
  }
  const check = await checkVault(vault);
  if (check.status === "invalid") {
    return <main style={{ padding: 24 }}>Este link de cobro no es válido. Pedile al comercio que te pase el QR de nuevo.</main>;
  }
  if (check.status === "error" || !vault) {
    return <main style={{ padding: 24 }}>No pudimos verificar el comercio. Probá de nuevo en unos minutos; no hiciste ningún pago.</main>;
  }
  const h = await headers();
  const base = process.env.NEXT_PUBLIC_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const counterUrl = `${base}/?vault=${vault}`;
  const fixed = parseAmount(amount);
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24, display: "grid", gap: 24 }}>
      <h1 style={{ margin: 0 }}>Tildai ✓</h1>
      <AmountForm vault={vault} fixed={fixed} sale={parsedSale.sale} />
      <section style={{ textAlign: "center" }}>
        <p>QR del mostrador</p>
        <QRCodeSVG value={counterUrl} size={200} />
      </section>
    </main>
  );
}
