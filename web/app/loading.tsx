import styles from "./Cobro.module.css";

export default function Loading() {
  return (
    <main className={styles.shell} aria-busy="true">
      <span className={styles.srOnly}>Cargando…</span>
      <div className={styles.card} aria-hidden="true">
        <div className={styles.amountWrap}>
          <span className={`${styles.skel} ${styles.skelLabel}`} />
          <span className={`${styles.skel} ${styles.skelAmount}`} />
        </div>
        <div className={styles.actions}>
          <span className={`${styles.skel} ${styles.skelBtn}`} />
          <span className={`${styles.skel} ${styles.skelBtn}`} />
        </div>
      </div>
    </main>
  );
}
