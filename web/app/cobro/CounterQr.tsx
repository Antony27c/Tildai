import { QRCodeSVG } from "qrcode.react";
import styles from "../Cobro.module.css";

export default function CounterQr({ url }: { url: string }) {
  return (
    <section className={styles.qr} aria-label="QR del mostrador">
      <h2 className={styles.qrTitle}>QR del mostrador</h2>
      <div className={styles.qrBox}>
        <QRCodeSVG value={url} size={176} />
      </div>
      <p className={styles.qrHint}>El cliente lo escanea y escribe el monto.</p>
    </section>
  );
}
