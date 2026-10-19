import type { PollOutcome } from "../../lib/poll.ts";

export type PayStatus = { tone: "info" | "ok" | "warn"; title: string; body?: string; retry?: boolean; tick?: boolean };

// "Cobrada" SOLO sale de outcome "cobrada" (el indexer lo confirmó vía pollSale).
// Un txHash sin venta es "Pago enviado": la red lo confirmó, el comercio todavía no lo anotó.
export function payStatus(p: { paid: boolean; pending: boolean; settled: boolean; outcome: PollOutcome | null }): PayStatus | null {
  if (!p.paid) return null;
  if (p.pending) return { tone: "warn", title: "Estamos confirmando tu pago", body: "Si se te descontó plata, no vuelvas a pagar." };
  if (p.outcome === "cobrada") return { tone: "ok", title: "Cobrada", body: "El comercio ya la tiene anotada.", tick: true };
  if (p.settled) return { tone: "ok", title: "Pago enviado", body: "La red confirmó tu pago. Mostrale esta pantalla al comercio.", tick: true };
  if (p.outcome === "timeout") return { tone: "warn", title: "Todavía no se anotó", body: "Si ya pagaste, el comercio te avisa apenas entre.", retry: true };
  return { tone: "info", title: "Confirmando tu pago…" };
}
