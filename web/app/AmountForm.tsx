"use client";
import { useEffect, useState } from "react";
import { pollSale, type PollOutcome } from "../lib/poll.ts";
import { buildRipioLink, parseAmount } from "../lib/ripio.ts";
import { payUrl } from "../lib/sale.ts";

export default function AmountForm({ vault, fixed, sale }: { vault: string; fixed: number | null; sale: string | null }) {
  const [raw, setRaw] = useState(fixed ? String(fixed) : "");
  const amount = parseAmount(raw);
  const [paid, setPaid] = useState(false);
  const [outcome, setOutcome] = useState<PollOutcome | null>(null);
  useEffect(() => {
    if (!paid || !sale) return;
    const ctl = new AbortController();
    pollSale(sale, { signal: ctl.signal }).then(setOutcome);
    return () => ctl.abort();
  }, [paid, sale]);
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
      <button
        disabled={!amount}
        onClick={() => {
          if (!amount) return;
          const link = buildRipioLink(amount, vault);
          if (!sale) return void (window.location.href = link);
          window.open(link, "_blank", "noopener");
          setPaid(true);
        }}
        style={{ fontSize: 20, padding: 16, borderRadius: 12, border: 0, background: amount ? "#0a7d3b" : "#aaa", color: "#fff" }}
      >
        Pagar con pesos
      </button>
      {paid && (
        <p role="status">
          {outcome === "cobrada" ? "✓ Pago confirmado" : outcome === "timeout" ? "Seguimos confirmando; el comercio te avisa." : "Pago enviado, confirmando…"}
        </p>
      )}
    </div>
  );
}
