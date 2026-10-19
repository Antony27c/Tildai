import Link from "next/link";
import { checkVault } from "../../lib/vaults.ts";
import { byDay, fetchPanel, formatDiaHoraAR, formatHoraAR, formatPesos, parseDia, periodRangeAR, readVaultBalance, summarize } from "../../lib/panel.ts";
import styles from "./panel.module.css";

export const dynamic = "force-dynamic";

const AR = "America/Argentina/Buenos_Aires";
const fechaFmt = new Intl.DateTimeFormat("es-AR", { timeZone: AR, dateStyle: "full" });
const cortaFmt = new Intl.DateTimeFormat("es-AR", { timeZone: AR, day: "numeric", month: "long" });
const diaFmt = new Intl.DateTimeFormat("es-AR", { timeZone: AR, weekday: "short", day: "numeric", month: "numeric" });
const DIAS = [
  ["hoy", "Hoy"],
  ["ayer", "Ayer"],
  ["7d", "Últimos 7 días"],
] as const;
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

export default async function PanelPage({ searchParams }: { searchParams: Promise<{ vault?: string; dia?: string }> }) {
  const { vault, dia: diaParam } = await searchParams;
  // shortcut: panel público por vault (los datos ya son públicos onchain), agregar login del dueño antes de mostrar datos no públicos
  const check = await checkVault(vault);
  if (!vault || check.status === "invalid") return <ErrorPage msg={INVALID_LINK} />;
  if (check.status === "error") return <ErrorPage msg="No pudimos verificar el comercio. Probá de nuevo en unos minutos." />;

  const dia = parseDia(diaParam);
  const now = Date.now();
  const { since, until } = periodRangeAR(dia, now);
  const [data, balance] = await Promise.all([fetchPanel(vault, since, until), readVaultBalance(vault)]);
  if (!data.ok) return <ErrorPage msg={LOAD_ERROR} />;

  const s = summarize(data.sales, data.payments);
  const pagos = [...data.payments].reverse(); // el más nuevo arriba
  const titulo = dia === "hoy" ? "Caja de hoy" : dia === "ayer" ? "Caja de ayer" : "Últimos 7 días";
  const fecha =
    dia === "7d" ? `del ${cortaFmt.format(since)} al ${cortaFmt.format(until - 1)}` : fechaFmt.format(since);
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{titulo}</h1>
          <p className={styles.date}>{fecha}</p>
        </div>
        <Link className={styles.link} href={`/?vault=${vault}`}>
          Ver página de cobro
        </Link>
      </header>

      <nav className={styles.tabs} aria-label="Período">
        {DIAS.map(([k, label]) => (
          <Link key={k} className={k === dia ? styles.tabActive : styles.tab} href={`/panel?vault=${vault}&dia=${k}`} aria-current={k === dia ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      <section className={styles.stats}>
        <div className={`${styles.card} ${styles.cardWide}`}>
          <p className={styles.label}>{dia === "hoy" ? "Cobrado hoy" : "Cobrado"}</p>
          <p className={styles.big}>$ {formatPesos(s.totalWei)}</p>
        </div>
        <div className={styles.card}>
          <p className={styles.label}>Pagos</p>
          <p className={styles.big}>{s.pagos}</p>
        </div>
        <div className={styles.card}>
          <p className={styles.label}>Ventas</p>
          <p className={styles.big}>
            {s.cobradas} <span className={styles.small}>cobradas</span>
          </p>
          <p className={styles.note}>{s.pendientes} pendientes</p>
        </div>
        <div className={styles.card}>
          <p className={styles.label}>Saldo del vault</p>
          {balance === null ? (
            <p className={styles.unavailable}>No disponible</p>
          ) : (
            <p className={styles.big}>$ {formatPesos(balance)}</p>
          )}
        </div>
      </section>

      {dia === "7d" && (
        <section>
          <h2 className={styles.sectionTitle}>Por día</h2>
          <ul className={styles.list}>
            {byDay(data.payments, since, until).map((d) => (
              <li key={d.daySince} className={styles.row}>
                <span>{diaFmt.format(d.daySince)}</span>
                <span className={styles.amount}>$ {formatPesos(d.totalWei)}</span>
                <span className={styles.num}>
                  {d.count} {d.count === 1 ? "pago" : "pagos"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className={styles.sectionTitle}>Cobros</h2>
        {pagos.length === 0 ? (
          <p className={styles.muted}>{dia === "hoy" ? "Todavía no entró plata hoy." : "No hubo cobros en este período."}</p>
        ) : (
          <ul className={styles.list}>
            {pagos.map((p) => (
              <li key={p.id} className={styles.row}>
                <span className={styles.num}>
                  {p.timestamp === null ? "--:--" : dia === "7d" ? formatDiaHoraAR(p.timestamp) : formatHoraAR(p.timestamp)}
                </span>
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
