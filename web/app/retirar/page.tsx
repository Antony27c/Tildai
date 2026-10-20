import { loadVault } from "../../lib/retirar.ts";
import { networkName } from "../../lib/stats.ts";
import RetirarClient from "./RetirarClient.tsx";
import styles from "./retirar.module.css";

// Siempre se consulta la red: los saldos y el owner no se cachean.
export const dynamic = "force-dynamic";
export const metadata = { title: "Tildai - retirar de la caja" };

const MENSAJES = {
  invalid: "Este link no corresponde a una caja de Tildai.",
  no_network: "Red no configurada.",
  error: "No pudimos leer la caja ahora, probá en un rato.",
} as const;

export default async function RetirarPage({ searchParams }: { searchParams: Promise<{ vault?: string }> }) {
  const { vault } = await searchParams;
  const r = await loadVault(vault);
  if (r.kind !== "ok") {
    return (
      <main className={styles.main}>
        <p className={styles.brand}>Tildai ✓</p>
        <h1 className={styles.title}>Retirar de tu caja</h1>
        <p className={styles.error}>{MENSAJES[r.kind]}</p>
      </main>
    );
  }
  return (
    <main className={styles.main}>
      <p className={styles.brand}>Tildai ✓</p>
      <h1 className={styles.title}>Retirar de tu caja</h1>
      <RetirarClient vault={String(vault)} chainId={r.chainId} owner={r.owner} tokens={r.tokens} scan={r.scan} />
      <p className={styles.note}>La plata va a tu billetera conectada y solo vos podés firmar el retiro.</p>
      <footer className={styles.footer}>Red: {networkName(r.chainId)}</footer>
    </main>
  );
}
