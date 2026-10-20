"use client";
import { useEffect } from "react";
import Notice from "./cobro/Notice.tsx";
import styles from "./Cobro.module.css";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="es-AR">
      <body>
        <Notice
          tone="danger"
          title="Algo falló de este lado"
          action={
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={reset}>
              Reintentar
            </button>
          }
        >
          Si estabas pagando, revisá con el comercio antes de pagar de nuevo.
        </Notice>
      </body>
    </html>
  );
}
