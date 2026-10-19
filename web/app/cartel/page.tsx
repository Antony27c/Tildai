import { headers } from "next/headers";
import { QRCodeSVG } from "qrcode.react";
import { checkVault } from "../../lib/vaults.ts";
import { cartelBase, counterUrl, sanitizeNombre } from "../../lib/cartel.ts";
import PrintButton from "./PrintButton.tsx";
import styles from "./cartel.module.css";

export const metadata = { title: "Tildai - cartel de cobro" };

export default async function CartelPage({ searchParams }: { searchParams: Promise<{ vault?: string; nombre?: string }> }) {
  const { vault, nombre } = await searchParams;
  const check = await checkVault(vault);
  if (check.status === "invalid") {
    return <main className={styles.main}><p className={styles.error}>Este link de cartel no es válido. Pedile al comercio que lo genere de nuevo.</p></main>;
  }
  if (check.status === "error" || !vault) {
    return <main className={styles.main}><p className={styles.error}>No pudimos verificar el comercio. Probá de nuevo en unos minutos.</p></main>;
  }
  const h = await headers();
  const url = counterUrl(vault, cartelBase(process.env, h));
  const nombreOk = sanitizeNombre(nombre);
  return (
    <main className={styles.main}>
      <PrintButton />
      <section className={styles.poster}>
        <p className={styles.brand}>Tildai ✓</p>
        {nombreOk && <p className={styles.nombre}>{nombreOk}</p>}
        <h1 className={styles.title}>Pagá acá con pesos</h1>
        <div className={styles.qr}>
          <QRCodeSVG value={url} size={512} />
        </div>
        <ol className={styles.steps}>
          <li>Escaneá el código con la cámara del celu.</li>
          <li>Poné el monto de tu compra.</li>
          <li>Pagá con pesos o con tu wallet.</li>
        </ol>
        <p className={styles.foot}>Pagás en pesos, sin wallet ni gas.</p>
      </section>
    </main>
  );
}
