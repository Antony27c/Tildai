import type { ReactNode } from "react";
import Tick from "./Tick.tsx";
import styles from "../Cobro.module.css";

export default function Notice({ tone, title, children, action }: { tone: "warn" | "danger"; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className={styles.shell}>
      <p className={styles.logo}>
        Tildai
        <Tick className={styles.logoTick} />
      </p>
      <div className={styles.notice} data-tone={tone}>
        <h1 className={styles.noticeTitle}>{title}</h1>
        <p className={styles.noticeBody}>{children}</p>
        {action && <div className={styles.noticeAction}>{action}</div>}
      </div>
    </main>
  );
}
