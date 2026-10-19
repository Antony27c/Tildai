import { verifyComprobante } from "../../lib/comprobante.ts";
import { formatPesos, networkName } from "../../lib/stats.ts";
import styles from "./comprobante.module.css";

// Siempre se consulta la red: los estados no confirmados no se cachean.
export const dynamic = "force-dynamic";
export const metadata = { title: "Tildai - comprobante de pago" };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const MENSAJES = {
  invalid_hash: "Ese link no es un comprobante válido.",
  no_network: "Red no configurada.",
  unavailable: "No pudimos verificar el pago ahora, probá en un rato.",
  not_payment: "Este link no prueba un pago a un comercio de Tildai.",
} as const;

export default async function ComprobantePage({ searchParams }: { searchParams: Promise<{ tx?: string }> }) {
  const { tx } = await searchParams;
  const r = await verifyComprobante(tx);
  if (r.kind !== "confirmed" && r.kind !== "pending") {
    return (
      <main className={styles.main}>
        <p className={styles.brand}>Tildai ✓</p>
        <h1 className={styles.title}>Comprobante de pago</h1>
        <p className={styles.error}>{MENSAJES[r.kind]}</p>
      </main>
    );
  }
  const fecha = r.blockTime.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    <main className={styles.main}>
      <p className={styles.brand}>Tildai ✓</p>
      <h1 className={r.kind === "confirmed" ? styles.ok : styles.warn}>
        {r.kind === "confirmed" ? "Pago confirmado en la red" : "Pago visto en la red, esperando confirmación"}
      </h1>
      <section className={styles.card}>
        {r.rows.map((row, i) => (
          <div key={i} className={styles.row}>
            <span className={styles.amount}>{formatPesos(row.amount.toString())}</span>
            <span className={styles.addr}>a {short(row.to)}</span>
          </div>
        ))}
        <dl className={styles.data}>
          <dt>Fecha y hora (AR)</dt>
          <dd>{fecha}</dd>
          <dt>Confirmaciones</dt>
          <dd>{r.confirmations}</dd>
          <dt>Transacción</dt>
          <dd>{tx && <span className={styles.mono}>{short(tx)}</span>}</dd>
        </dl>
        <a className={styles.link} href={r.scan} target="_blank" rel="noreferrer">
          Ver en el explorador
        </a>
      </section>
      <p className={styles.note}>Este comprobante muestra la transferencia en la red. El registro de la venta lo hace el sistema del comercio.</p>
      <footer className={styles.footer}>Red: {networkName(process.env.TILDAI_CHAIN_ID)}</footer>
    </main>
  );
}
