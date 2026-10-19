import { fetchStats, formatPesos, networkName } from "../../lib/stats.ts";
import styles from "./metricas.module.css";

// La página se renderiza por pedido (así un build sin env vars no hornea el error);
// el fetch al indexer se cachea 60 segundos vía next.revalidate en stats.ts.
export const dynamic = "force-dynamic";

const enteros = new Intl.NumberFormat("es-AR");

export default async function MetricasPage() {
  const r = await fetchStats();
  if (!r.ok) {
    console.error(JSON.stringify({ event: "stats_failed", reason: r.reason }));
    return (
      <main className={styles.main}>
        <h1 className={styles.title}>Métricas de Tildai</h1>
        <p className={styles.error}>No pudimos cargar las métricas. Probá de nuevo en unos minutos.</p>
        <Footer red={networkName(process.env.TILDAI_CHAIN_ID)} />
      </main>
    );
  }
  const s = r.stats;
  const red = networkName(s.chainId ?? process.env.TILDAI_CHAIN_ID);
  const max = s.byDay.reduce((m, d) => (BigInt(d.warsReceived) > m ? BigInt(d.warsReceived) : m), 0n);
  const gen = new Date(s.generatedAt);
  const actualizado = Number.isNaN(gen.getTime()) ? s.generatedAt
    : gen.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Métricas de Tildai</h1>
      <p className={styles.sub}>Cada cobro, tildado. Datos del indexer · {red}.</p>
      <section className={styles.grid}>
        <Card label="Total cobrado" value={formatPesos(s.warsReceived)} className={styles.total} />
        <Card label="Comercios" value={enteros.format(s.vaults)} />
        <Card label="Activos últimos 7 días" value={enteros.format(s.activeVaults7d)} />
        <Card label="Pagos confirmados" value={enteros.format(s.payments)} />
        <Card label="Ventas cobradas" value={enteros.format(s.salesCobradas)} />
      </section>
      <section>
        <h2 className={styles.h2}>Cobrado por día · últimos 14 días</h2>
        <div className={styles.chart} role="img" aria-label="Cobrado en pesos por día, últimos 14 días">
          {s.byDay.map((d) => {
            const v = BigInt(d.warsReceived);
            const pct = v > 0n ? Math.max(2, Number((v * 100n) / max)) : 0;
            return (
              <div key={d.day} className={styles.col} title={`${d.day}: ${formatPesos(d.warsReceived)} · ${d.payments} pagos`}>
                <div className={styles.barBox}>
                  <div className={styles.bar} style={{ height: `${pct}%` }} />
                </div>
                <span className={styles.day}>{d.day.slice(8)}</span>
              </div>
            );
          })}
        </div>
        {s.byDay.length === 0 && <p className={styles.note}>Todavía no hay pagos en el período.</p>}
      </section>
      {s.paymentsWithoutTimestamp > 0 && (
        <p className={styles.note}>
          {s.paymentsWithoutTimestamp === 1
            ? "1 pago no tiene fecha registrada y no figura en el gráfico diario."
            : `${s.paymentsWithoutTimestamp} pagos no tienen fecha registrada y no figuran en el gráfico diario.`}
        </p>
      )}
      <Footer red={red} actualizado={actualizado} />
    </main>
  );
}

function Card({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`${styles.card}${className ? ` ${className}` : ""}`}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </div>
  );
}

function Footer({ red, actualizado }: { red: string; actualizado?: string }) {
  return (
    <footer className={styles.footer}>
      Datos del indexer de Tildai · Red: {red}
      {actualizado ? ` · Actualizado ${actualizado} (hora AR)` : ""}
    </footer>
  );
}
