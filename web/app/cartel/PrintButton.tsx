"use client";

import styles from "./cartel.module.css";

export default function PrintButton() {
  return (
    <button type="button" className={styles.printBtn} onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
