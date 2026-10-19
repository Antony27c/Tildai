import { formatPesos, pesosToWei, weiToPesos } from "./money.ts";
import type { Vault } from "./vault.ts";

export type Sale = {
  id: number;
  amount: bigint;
  status: "pendiente" | "cobrada";
  createdAt: number;
  paidAt?: number;
  transferId?: string;
  notified: boolean;
};

const DAY = 86_400_000;
const AR_OFFSET = 3 * 3_600_000; // Argentina is UTC-3 all year
export const dayIndex = (ts: number) => Math.floor((ts - AR_OFFSET) / DAY);

// shortcut: in-memory sales, lost on restart; persist when the indexer lands.
export class SalesBook {
  sales: Sale[] = [];
  private claimed = new Set<string>();

  vault: Vault;
  private now: () => number;

  constructor(vault: Vault, now: () => number = Date.now) {
    this.vault = vault;
    this.now = now;
  }

  /** Marks a sale as cobrada only for confirmed Transfers; on any vault error nothing changes. */
  async reconcile(): Promise<{ verified: boolean; newlyPaid: Sale[] }> {
    let transfers;
    try {
      transfers = await this.vault.transfers();
    } catch (err) {
      console.error("[tildai] no se pudo leer el vault, las ventas siguen pendientes", err);
      return { verified: false, newlyPaid: [] };
    }
    const newlyPaid: Sale[] = [];
    for (const t of transfers) {
      if (!t.confirmed || this.claimed.has(t.id)) continue;
      this.claimed.add(t.id);
      // shortcut: a Transfer carries no memo, so match the oldest pending sale with the same amount created at or before the Transfer; an unmatched one is a QR-fijo sale.
      let sale = this.sales.find((s) => s.status === "pendiente" && s.amount === t.amount && t.timestamp >= s.createdAt);
      if (!sale) {
        sale = { id: this.sales.length + 1, amount: t.amount, status: "pendiente", createdAt: t.timestamp, notified: false };
        this.sales.push(sale);
      }
      sale.status = "cobrada";
      sale.paidAt = t.timestamp;
      sale.transferId = t.id;
      newlyPaid.push(sale);
    }
    return { verified: true, newlyPaid };
  }

  create(pesos: number): Sale {
    const sale: Sale = { id: this.sales.length + 1, amount: pesosToWei(pesos), status: "pendiente", createdAt: this.now(), notified: false };
    this.sales.push(sale);
    return sale;
  }

  private paidOn(day: number) {
    return this.sales.filter((s) => s.status === "cobrada" && dayIndex(s.paidAt!) === day);
  }

  stats(day: number) {
    const paid = this.paidOn(day);
    const total = paid.reduce((a, s) => a + s.amount, 0n);
    return { total, count: paid.length, avg: paid.length ? total / BigInt(paid.length) : 0n };
  }

  today() {
    return dayIndex(this.now());
  }
}

export function crearCobro(book: SalesBook, input: { monto: number }, payBaseUrl: string) {
  const sale = book.create(input.monto);
  const pesos = Number(input.monto);
  const link = `${payBaseUrl.replace(/\/$/, "")}/?vault=${book.vault.address}&amount=${pesos}`;
  // Ripio on-ramp pays the vault directly (see AGENTS.md).
  const rampLink = `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=${pesos}&address=${book.vault.address}`;
  return { ventaId: sale.id, monto: formatPesos(sale.amount), estado: sale.status, link, rampLink };
}

export async function ventasHoy(book: SalesBook) {
  const { verified } = await book.reconcile();
  const day = book.today();
  const { total, count, avg } = book.stats(day);
  const pendientes = book.sales.filter((s) => s.status === "pendiente");
  return {
    verificado: verified,
    aviso: verified ? undefined : "No pude verificar los pagos onchain: lo pendiente sigue como pendiente.",
    total: formatPesos(total),
    cantidad: count,
    ticketPromedio: formatPesos(avg),
    pendientes: pendientes.map((s) => ({ ventaId: s.id, monto: formatPesos(s.amount) })),
  };
}

export async function avisoPago(book: SalesBook) {
  const { verified } = await book.reconcile();
  const nuevos = book.sales.filter((s) => s.status === "cobrada" && !s.notified);
  nuevos.forEach((s) => (s.notified = true));
  return { verificado: verified, avisos: nuevos.map((s) => `✓ Entraron ${formatPesos(s.amount)} (venta #${s.id})`) };
}

export async function cierreCaja(book: SalesBook) {
  const { verified } = await book.reconcile();
  const day = book.today();
  const hoy = book.stats(day);
  const prev = book.stats(day - 7);
  const pendientes = book.sales.filter((s) => s.status === "pendiente").length;
  const vs = prev.total === 0n ? null : Math.round((Number(hoy.total - prev.total) / Number(prev.total)) * 100);
  const lines = [
    "Cierre de caja",
    `Total: ${formatPesos(hoy.total)}`,
    `Ventas: ${hoy.count}`,
    `Ticket promedio: ${formatPesos(hoy.avg)}`,
    vs === null ? "Sin ventas el mismo día de la semana pasada para comparar." : `Vs. mismo día de la semana pasada (${formatPesos(prev.total)}): ${vs > 0 ? "+" : ""}${vs}%`,
  ];
  if (pendientes) lines.push(`Pendientes de confirmar: ${pendientes}`);
  if (!verified) lines.push("No pude verificar los pagos onchain; el total puede estar incompleto.");
  return { verificado: verified, total: weiToPesos(hoy.total), cantidad: hoy.count, ticketPromedio: weiToPesos(hoy.avg), totalSemanaPasada: weiToPesos(prev.total), variacionPct: vs, resumen: lines.join("\n") };
}

export const diaISO = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
