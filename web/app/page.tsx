import { headers } from "next/headers";
import AmountForm from "./AmountForm.tsx";
import Landing from "./Landing.tsx";
import Notice from "./cobro/Notice.tsx";
import CounterQr from "./cobro/CounterQr.tsx";
import styles from "./Cobro.module.css";
import { parseAmount } from "../lib/ripio.ts";
import { parseSale } from "../lib/sale.ts";
import { checkVault } from "../lib/vaults.ts";

const INVALID_LINK = (
  <Notice tone="warn" title="Este link de cobro no sirve">
    Pedile al comercio que te pase el QR de nuevo. No hiciste ningún pago.
  </Notice>
);

export default async function Page({ searchParams }: { searchParams: Promise<{ vault?: string; amount?: string; sale?: string }> }) {
  const { vault, amount, sale } = await searchParams;
  if (vault === undefined && amount === undefined && sale === undefined) return <Landing />;
  const parsedSale = parseSale(sale);
  if (!parsedSale.ok) return INVALID_LINK;
  const check = await checkVault(vault);
  if (check.status === "invalid") return INVALID_LINK;
  if (check.status === "error" || !vault) {
    return (
      <Notice tone="warn" title="No pudimos verificar el comercio">
        Probá de nuevo en unos minutos; no hiciste ningún pago.
      </Notice>
    );
  }
  const h = await headers();
  const base = process.env.NEXT_PUBLIC_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const counterUrl = `${base}/?vault=${vault}`;
  const fixed = parseAmount(amount);
  return (
    <main className={styles.shell}>
      <header className={styles.brand}>
        <h1 className={styles.logo}>Tildai ✓</h1>
        <span className={styles.tagline}>cada cobro, tildado</span>
      </header>
      <AmountForm vault={vault} fixed={fixed} sale={parsedSale.sale} />
      <CounterQr url={counterUrl} />
    </main>
  );
}
