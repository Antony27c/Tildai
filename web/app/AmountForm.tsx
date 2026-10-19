"use client";
import { useEffect, useState } from "react";
import { buildRipioLink, parseAmount } from "../lib/ripio.ts";
import { payUrl } from "../lib/sale.ts";
import { pollSale, type PollOutcome } from "../lib/poll.ts";
import { checkWarsWallet, payWithWars } from "../lib/buyer.ts";
import { choosePayOption, PESOS_NOTE, X402_MIN, type PayOption } from "../lib/wars.ts";
import { payStatus } from "./cobro/status.ts";
import Tick from "./cobro/Tick.tsx";
import styles from "./Cobro.module.css";

declare global {
  interface Window {
    ethereum?: unknown;
  }
}

const fmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

export default function AmountForm({ vault, fixed, sale }: { vault: string; fixed: number | null; sale: string | null }) {
  const [raw, setRaw] = useState(fixed ? String(fixed) : "");
  const amount = parseAmount(raw);
  const [option, setOption] = useState<PayOption | null>(null);
  const [paid, setPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PollOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    checkWarsWallet(window.ethereum).then((c) => setOption(choosePayOption(c)));
  }, []);
  useEffect(() => {
    if (option !== "wars" || !amount) return;
    const t = setTimeout(
      () =>
        checkWarsWallet(window.ethereum, amount).then((c) => {
          if (c === "insufficient" || c === "no_wallet") setOption("pesos");
        }),
      400,
    );
    return () => clearTimeout(t);
  }, [amount, option]);
  useEffect(() => {
    if (!paid || !sale) return;
    const ctl = new AbortController();
    pollSale(sale, { signal: ctl.signal }).then(setOutcome);
    return () => ctl.abort();
  }, [paid, sale]);
  const payPesos = () => {
    if (!amount) return;
    const link = buildRipioLink(amount, vault);
    if (!sale) return void (window.location.href = link);
    window.open(link, "_blank", "noopener");
    setPaid(true);
  };
  const payWars = async () => {
    if (!amount) return;
    setErr(null);
    setPaying(true);
    const r = await payWithWars(window.ethereum, vault, amount, sale);
    setPaying(false);
    if (r.ok) {
      setPaid(true);
      // sin sale no hay poll del indexer: solo "Pago enviado" (la red confirmó), nunca "Cobrada"
      if (r.pending) setPending(true);
      else if (!sale) setSettled(true);
    }
    else setErr(r.reason);
  };
  const status = payStatus({ paid, pending, settled, outcome });
  const warsEnabled = option === "wars" && (!amount || amount >= X402_MIN);
  return (
    <section className={styles.card} data-pay-url={amount ? payUrl(vault, amount, sale) : undefined} aria-label="Cobro">
      <div className={styles.amountWrap}>
        {fixed ? (
          <>
            <span className={styles.amountLabel}>Total a pagar</span>
            <strong className={styles.amount}>{fmt.format(fixed)}</strong>
          </>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="monto">
              ¿Cuánto vas a pagar?
            </label>
            <input
              id="monto"
              className={styles.input}
              inputMode="decimal"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="$ 0"
              aria-describedby="monto-hint"
            />
            <p className={styles.hint} id="monto-hint">
              En pesos. Podés escribir 8.500 o 8500,50.
            </p>
          </div>
        )}
        {!fixed && amount && <strong className={styles.amount}>{fmt.format(amount)}</strong>}
      </div>
      {!paid && (
        <div className={styles.actions}>
          {option === null && <p className={styles.muted}>Viendo si tenés wallet…</p>}
          {warsEnabled && (
            <button className={`${styles.btn} ${styles.primary}`} disabled={!amount || paying} onClick={payWars}>
              {paying ? "Esperando tu firma…" : "Pagar con wARS"}
            </button>
          )}
          <button
            className={`${styles.btn} ${warsEnabled ? styles.secondary : styles.primary}`}
            disabled={!amount || paying}
            onClick={payPesos}
          >
            Pagar con pesos
          </button>
          {option === "wars" && amount !== null && amount < X402_MIN && (
            <p className={styles.hint}>Con wARS el mínimo es $ {X402_MIN}; con pesos no hay mínimo.</p>
          )}
          {option === "pesos" && <p className={styles.hint}>{PESOS_NOTE}</p>}
        </div>
      )}
      {err && (
        <p className={styles.status} data-tone="danger" role="alert">
          {err}
        </p>
      )}
      <div role="status" aria-live="polite">
        {status && (
          <div className={styles.status} data-tone={status.tone}>
            <strong className={styles.statusTitle}>
              {status.tick && <Tick className={styles.tickOk} />}
              {status.title}
            </strong>
            {status.body && <span className={styles.statusBody}>{status.body}</span>}
            {status.retry && (
              <button className={`${styles.btn} ${styles.secondary} ${styles.btnSmall}`} onClick={() => window.location.reload()}>
                Revisar de nuevo
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
