import type { ReactNode } from "react";
import styles from "../Cobro.module.css";

export default function Notice({ tone, title, children }: { tone: "warn" | "danger"; title: string; children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <p className={styles.logo}>Tildai ✓</p>
      <div className={styles.notice} data-tone={tone}>
        <h1 className={styles.noticeTitle}>{title}</h1>
        <p className={styles.noticeBody}>{children}</p>
      </div>
    </main>
  );
}
