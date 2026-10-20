import Link from "next/link";
import Notice from "./cobro/Notice.tsx";
import styles from "./Cobro.module.css";

export default function NotFound() {
  return (
    <Notice
      tone="warn"
      title="Esta página no existe"
      action={
        <Link href="/" className={`${styles.btn} ${styles.primary}`}>
          Ir al inicio
        </Link>
      }
    >
      Puede que el link esté mal escrito o vencido. Si te pasaron un link de cobro, pedile al comercio que te lo mande de nuevo.
    </Notice>
  );
}
