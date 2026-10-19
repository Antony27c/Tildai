import styles from "./panel.module.css";

export default function Loading() {
  return (
    <main className={styles.main}>
      <p className={styles.muted}>Cargando tu caja…</p>
    </main>
  );
}
