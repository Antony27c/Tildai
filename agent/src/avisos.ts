import type { Address } from "viem";

import type { Indexer } from "./indexerClient.ts";
import { escribirJsonAtomico, leerJson } from "./jsonFile.ts";
import { formatPesos } from "./money.ts";

/**
 * Last /events seq delivered to Telegram plus the paymentIds already notified (a pago_sin_venta and the
 * venta_cobrada it later becomes share paymentId). Persisted atomically so a restart never duplicates or skips.
 * shortcut: `avisados` grows one entry per payment; prune to the last N if a merchant ever has millions.
 */
export class EventCursor {
  cursor = 0;
  private avisados = new Set<string>();
  private file: string | undefined;

  private constructor(file: string | undefined) {
    this.file = file;
  }

  static load(file: string | undefined) {
    const c = new EventCursor(file);
    if (file) {
      const d = leerJson(file, "de avisos");
      if (typeof d?.cursor === "number") c.cursor = d.cursor;
      for (const id of d?.avisados ?? []) c.avisados.add(id);
    }
    return c;
  }

  visto(paymentId: string) {
    return this.avisados.has(paymentId);
  }

  /** Persists the new position (and the notified payment, if any) before returning: it never advances ahead of a sent message. */
  async avanzar(seq: number, paymentId?: string) {
    this.cursor = seq;
    if (paymentId) this.avisados.add(paymentId);
    await this.save();
  }

  /** The indexer restarted with an empty store and rejects our cursor: start over, `avisados` still prevents re-notifying. */
  async reset() {
    this.cursor = 0;
    await this.save();
  }

  private async save() {
    if (this.file) await escribirJsonAtomico(this.file, { version: 1, cursor: this.cursor, avisados: [...this.avisados] });
  }
}

/**
 * One poll of /events: sends each event to the chat that owns its vault, in seq order. The cursor only
 * advances after a successful send, so a Telegram failure stops the batch and the next poll retries.
 * The event payload has no vault, so it is resolved lazily through each registered vault's payments
 * (shortcut: N vault lookups per batch with events; drop it when the indexer exposes vault in pview).
 */
export async function avisarEventos(a: {
  indexer: Indexer;
  cursor: EventCursor;
  vaults: { chatId: string; vault: Address }[];
  send: (chatId: string, texto: string) => unknown;
}): Promise<void> {
  let res;
  try {
    res = await a.indexer.eventosDesde(a.cursor.cursor);
  } catch (err) {
    if ((err as { status?: number }).status === 400) {
      console.error(`[tildai] avisos: el indexer rechazó el cursor ${a.cursor.cursor} (store reiniciado); vuelvo a 0, los avisados evitan duplicar`);
      await a.cursor.reset();
      return;
    }
    throw err;
  }
  if (!res.events.length) return;

  let chatsDelPago: Map<string, string> | undefined;
  const chatDelPago = async (paymentId: string) => {
    if (!chatsDelPago) {
      chatsDelPago = new Map();
      for (const v of a.vaults) for (const p of await a.indexer.pagosDelVault(v.vault)) chatsDelPago.set(p.id, v.chatId);
    }
    return chatsDelPago.get(paymentId);
  };

  for (const e of res.events) {
    if (a.cursor.visto(e.paymentId)) {
      await a.cursor.avanzar(e.seq);
      continue;
    }
    const chatId = e.payment ? await chatDelPago(e.paymentId) : undefined;
    if (!e.payment || !chatId) {
      console.error(`[tildai] evento ${e.seq} (${e.type}) sin destino: ${e.payment ? `el vault del pago ${e.paymentId} no tiene chat` : `el pago ${e.paymentId} no está en el indexer`}`);
      await a.cursor.avanzar(e.seq);
      continue;
    }
    const monto = formatPesos(BigInt(e.payment.amount));
    await a.send(chatId, e.type === "venta_cobrada" ? `Entró una venta: ${monto} ✓` : `Te llegó un pago de ${monto} sin venta asociada`);
    await a.cursor.avanzar(e.seq, e.paymentId);
  }
}
