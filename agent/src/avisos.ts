import type { Address } from "viem";

import type { Indexer } from "./indexerClient.ts";
import { escribirJsonAtomico, leerJson } from "./jsonFile.ts";
import { formatPesos } from "./money.ts";

/** Failed sends of one event before it is skipped with an ALERTA (persisted in the cursor file). */
export const MAX_REINTENTOS_AVISO = 10;

/**
 * Errors Telegram never heals with a retry: the chat blocked/kicked the bot or no longer exists.
 * Anything else (network, 429, 5xx, an ambiguous 400) is transient. grammy errors carry `error_code`
 * and `description`; plain fetch failures carry neither. The wording stays Telegram-specific on
 * purpose: the send goes through a model session, and a provider error containing "blocked" or
 * "forbidden" must not deactivate a healthy chat.
 */
const PERMANENTE = /bot was blocked|chat not found|can't initiate|user is deactivated|kicked from|not a member|chat was (deleted|upgraded)/i;
function errorPermanente(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; error_code?: number; description?: string; message?: string };
  if (PERMANENTE.test(`${e?.message ?? ""} ${e?.description ?? ""}`)) return true;
  const code = e?.status ?? e?.statusCode ?? e?.error_code;
  return code === 403 || code === 404;
}

/**
 * Last /events seq delivered to Telegram, the `type:paymentId` pairs already notified (a pago_sin_venta
 * and the venta_cobrada it later becomes share the paymentId: each one notifies), the transient retry
 * count of the pending event, and — in memory only — the chats that rejected the bot for good (a restart
 * gives them one more chance). Persisted atomically so a restart never duplicates or skips.
 * shortcut: `avisados` grows one entry per event; prune to the last N if a merchant ever has millions.
 */
export class EventCursor {
  cursor = 0;
  private avisados = new Set<string>();
  private inactivos = new Set<string>();
  private reintentos = new Map<number, { n: number; hasta: number }>();
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
      for (const [seq, r] of Object.entries(d?.reintentos ?? {})) c.reintentos.set(Number(seq), r as { n: number; hasta: number });
    }
    return c;
  }

  visto(type: string, paymentId: string) {
    // Files from before the type:paymentId key hold bare paymentIds; they still count as notified.
    return this.avisados.has(`${type}:${paymentId}`) || this.avisados.has(paymentId);
  }

  chatInactivo(chatId: string) {
    return this.inactivos.has(chatId);
  }

  /** Permanently-rejecting chat: its events get skipped without another send until the process restarts. */
  desactivar(chatId: string) {
    this.inactivos.add(chatId);
  }

  /** True while a transiently-failed event sits inside its backoff window. */
  esperando(seq: number, now: number) {
    const r = this.reintentos.get(seq);
    return r != null && now < r.hasta;
  }

  /**
   * Counts a transient failure of one event (persisted) and schedules the next attempt: the first retry
   * just waits for the next poll, from the second failure the wait doubles (1m, 2m, 4m … 30m cap).
   */
  async fallo(seq: number, now: number) {
    const n = (this.reintentos.get(seq)?.n ?? 0) + 1;
    const espera = n === 1 ? 0 : Math.min(60_000 * 2 ** (n - 2), 30 * 60_000);
    this.reintentos.set(seq, { n, hasta: now + espera });
    await this.save();
    return n;
  }

  /** Persists the new position (and the notified event, if any) before returning: it never advances ahead of a sent message. */
  async avanzar(seq: number, type?: string, paymentId?: string) {
    this.cursor = seq;
    if (type && paymentId) this.avisados.add(`${type}:${paymentId}`);
    for (const k of [...this.reintentos.keys()]) if (k <= seq) this.reintentos.delete(k);
    await this.save();
  }

  /** The indexer restarted with an empty store and rejects our cursor: start over, `avisados` still prevents re-notifying. */
  async reset() {
    this.cursor = 0;
    this.reintentos.clear();
    await this.save();
  }

  private async save() {
    if (this.file) {
      await escribirJsonAtomico(this.file, {
        version: 2,
        cursor: this.cursor,
        avisados: [...this.avisados],
        reintentos: Object.fromEntries(this.reintentos),
      });
    }
  }
}

/**
 * One poll of /events: sends each event to the chat that owns its vault, in seq order. The cursor only
 * advances after a sent message. A permanent Telegram error (blocked/deleted chat) deactivates that chat
 * and skips the event with an ALERTA; a transient one stops the batch and retries with backoff on later
 * polls, up to MAX_REINTENTOS_AVISO per event, so one dead chat can never silence the rest.
 * The event payload has no vault, so it is resolved lazily through each registered vault's payments
 * (shortcut: N vault lookups per batch with events; drop it when the indexer exposes vault in pview).
 */
export async function avisarEventos(a: {
  indexer: Indexer;
  cursor: EventCursor;
  vaults: { chatId: string; vault: Address }[];
  send: (chatId: string, texto: string) => unknown;
  now?: () => number;
}): Promise<void> {
  const now = a.now ?? Date.now;
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
    if (a.cursor.visto(e.type, e.paymentId)) {
      await a.cursor.avanzar(e.seq);
      continue;
    }
    if (a.cursor.esperando(e.seq, now())) break; // transient failure still backing off: the batch stops and a later poll retries it
    const chatId = e.payment ? await chatDelPago(e.paymentId) : undefined;
    if (!e.payment || !chatId) {
      console.error(`[tildai] evento ${e.seq} (${e.type}) sin destino: ${e.payment ? `el vault del pago ${e.paymentId} no tiene chat` : `el pago ${e.paymentId} no está en el indexer`}`);
      await a.cursor.avanzar(e.seq);
      continue;
    }
    if (a.cursor.chatInactivo(chatId)) {
      console.error(`[tildai] evento ${e.seq} (${e.type}) salteado: el chat ${chatId} quedó inactivo`);
      await a.cursor.avanzar(e.seq);
      continue;
    }
    const monto = formatPesos(BigInt(e.payment.amount));
    const texto = e.type === "venta_cobrada" ? `Entró una venta: ${monto} ✓` : `Te llegó un pago de ${monto} sin venta asociada`;
    try {
      await a.send(chatId, texto);
    } catch (err) {
      if (errorPermanente(err)) {
        a.cursor.desactivar(chatId);
        console.error(`[tildai] ALERTA evento ${e.seq}: el chat ${chatId} rechaza al bot para siempre (${(err as Error).message}); queda inactivo y sus avisos se saltan`);
        await a.cursor.avanzar(e.seq);
        continue;
      }
      const n = await a.cursor.fallo(e.seq, now());
      if (n >= MAX_REINTENTOS_AVISO) {
        console.error(`[tildai] ALERTA evento ${e.seq} (${e.type}, pago ${e.paymentId}): ${n} envíos fallidos; se salta el aviso para no frenar al resto`, err);
        await a.cursor.avanzar(e.seq);
        continue;
      }
      throw err; // transient: the batch stops here and the next poll retries this same event
    }
    await a.cursor.avanzar(e.seq, e.type, e.paymentId);
  }
}
