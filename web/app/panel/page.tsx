import Link from "next/link";
import { checkVault } from "../../lib/vaults.ts";
import { dayRangeAR, fetchPanel, formatHoraAR, formatPesos, readVaultBalance, summarize } from "../../lib/panel.ts";
import styles from "./panel.module.css";

export const dynamic = "force-dynamic";

const fechaFmt = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "full" });
const INVALID_LINK = "Este link del panel no es válido. Pedile a Tildai el enlace de nuevo.";
const LOAD_ERROR = "No pudimos cargar las ventas, probá en un rato";

function ErrorPage({ msg }: { msg: string }) {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Tildai</h1>
      <p className={styles.error}>{msg}</p>
    </main>
  );
}

export default async function PanelPage({ searchParams }: { searchParams: Promise<{ vault?: string }> }) {
  const { vault } = await searchParams;
  // shortcut: panel público por vault (los datos ya son públicos onchain), agregar login del dueño antes de mostrar datos no públicos
  const check = await checkVault(vault);
  if (!vault || check.status === "invalid") return <ErrorPage msg={INVALID_LINK} />;
  if (check.status === "error") return <ErrorPage msg="No pudimos verificar el comercio. Probá de nuevo en unos minutos." />;

  const { since, until } = dayRangeAR(Date.now());
  const [data, balance] = await Promise.all([fetchPanel(vault, since, until), readVaultBalance(vault)]);
  if (!data.ok) return <ErrorPage msg={LOAD_ERROR} />;

  const s = summarize(data.sales, data.payments);
  const pagos = [...data.payments].reverse(); // el más nuevo arriba
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Caja de hoy</h1>
          <p className={styles.date}>{fechaFmt.format(Date.now())}</p>
        </div>
        <Link className={styles.link} href={`/?vault=${vault}`}>
          Ver página de cobro
        </Link>
      </header>

      <section className={styles.stats}>
        <div className={styles.card}>
          <p className={styles.label}>Cobrado hoy</p>
          <p className={styles.big}>$ {formatPesos(s.totalWei)}</p>
        </div>
        <div className={styles.card}>
          <p className={styles.label}>Pagos</p>
          <p className={styles.big}>{s.pagos}</p>
        </div>
        <div className={styles.card}>
          <p className={styles.label}>Ventas</p>
          <p className={styles.big}>{s.cobradas} <span className={styles.small}>cobradas</span></p>
          <p className={styles.note}>{s.pendientes} pendientes</p>
        </div>
        <div className={styles.card}>
          <p className={styles.label}>Saldo del vault</p>
          <p className={styles.big}>{balance === null ? "No disponible" : `$ ${formatPesos(balance)}`}</p>
        </div>
      </section>

      <section>
        <h2 className={styles.sectionTitle}>Cobros</h2>
        {pagos.length === 0 ? (
          <p className={styles.note}>Todavía no entró plata hoy.</p>
        ) : (
          <ul className={styles.list}>
            {pagos.map((p) => (
              <li key={p.id} className={styles.row}>
                <span className={styles.mono}>{p.timestamp === null ? "--:--" : formatHoraAR(p.timestamp)}</span>
                <span className={styles.amount}>$ {formatPesos(p.amount)}</span>
                <a className={styles.link} href={`https://celoscan.io/tx/${p.txHash}`} target="_blank" rel="noreferrer">
                  ver tx
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
