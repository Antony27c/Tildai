"use client";
import { useEffect, useState } from "react";
import { buildRipioLink, parseAmount } from "../lib/ripio.ts";
import { payUrl } from "../lib/sale.ts";
import { pollSale, type PollOutcome } from "../lib/poll.ts";
import { checkWarsWallet, payWithWars } from "../lib/buyer.ts";
import { choosePayOption, PESOS_NOTE, type PayOption } from "../lib/wars.ts";

declare global {
  interface Window {
    ethereum?: unknown;
  }
}

export default function AmountForm({ vault, fixed, sale }: { vault: string; fixed: number | null; sale: string | null }) {
  const [raw, setRaw] = useState(fixed ? String(fixed) : "");
  const amount = parseAmount(raw);
  const [option, setOption] = useState<PayOption | null>(null);
  const [paid, setPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PollOutcome | null>(null);
  const [pending, setPending] = useState(false);
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
      // sin sale no hay poll del indexer: el tilde sale del settle que ya confirmó el facilitador
      if (r.pending) setPending(true);
      else if (!sale) setOutcome("cobrada");
    }
    else setErr(r.reason);
  };
  return (
    <div style={{ display: "grid", gap: 12 }} data-pay-url={amount ? payUrl(vault, amount, sale) : undefined}>
      {!fixed && (
        <label style={{ display: "grid", gap: 4 }}>
          ¿Cuánto vas a pagar?
          <input
            inputMode="decimal"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="$ 0"
            style={{ fontSize: 28, padding: 12, borderRadius: 8, border: "1px solid #ccc" }}
          />
        </label>
      )}
      {amount && (
        <strong style={{ fontSize: 32 }}>
          {amount.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
        </strong>
      )}
      {option === "wars" && !paid && (
        <button
          disabled={!amount || paying}
          onClick={payWars}
          style={{ fontSize: 20, padding: 16, borderRadius: 12, border: 0, background: amount ? "#111" : "#aaa", color: "#fff" }}
        >
          {paying ? "Firmando…" : "Pagar con wARS"}
        </button>
      )}
      <button
        disabled={!amount}
        onClick={payPesos}
        style={{ fontSize: 20, padding: 16, borderRadius: 12, border: 0, background: amount ? "#0a7d3b" : "#aaa", color: "#fff" }}
      >
        Pagar con pesos
      </button>
      {option === "pesos" && <p style={{ margin: 0, fontSize: 14, color: "#555" }}>{PESOS_NOTE}</p>}
      {err && <p role="alert">{err}</p>}
      {paid && (
        <p role="status">
          {pending ? "Estamos confirmando tu pago, no vuelvas a pagar." : outcome === "cobrada" ? "✓ Pago confirmado" : outcome === "timeout" ? "Seguimos confirmando; el comercio te avisa." : "Pago enviado, confirmando…"}
        </p>
      )}
    </div>
  );
}
