"use client";
import { useState } from "react";
import { buildRipioLink, parseAmount } from "../lib/ripio.ts";
import { payUrl } from "../lib/sale.ts";

export default function AmountForm({ vault, fixed, sale }: { vault: string; fixed: number | null; sale: string | null }) {
  const [raw, setRaw] = useState(fixed ? String(fixed) : "");
  const amount = parseAmount(raw);
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
        onClick={() => amount && (window.location.href = buildRipioLink(amount, vault))}
        style={{ fontSize: 20, padding: 16, borderRadius: 12, border: 0, background: amount ? "#0a7d3b" : "#aaa", color: "#fff" }}
      >
        Pagar con pesos
      </button>
    </div>
  );
}
