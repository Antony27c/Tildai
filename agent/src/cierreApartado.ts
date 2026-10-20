import type { Address } from "viem";

import { ventasDelDia, type Indexer } from "./indexerClient.ts";
import { formatPesos } from "./money.ts";
import { cierreCaja, diaISO, type SalesBook } from "./sales.ts";
import type { BucketName, OpRecord, VaultOps } from "./vaultOps.ts";

type Bps = { ahorro: bigint; impuestos: bigint };

/** Percentages (0-100, up to 2 decimals) as basis points. Missing or invalid values never default: nothing gets set aside. */
export function parsePcts(env: { savings?: string; taxes?: string }): { ok: true; bps: Bps } | { ok: false; error: string } {
  const one = (name: string, raw?: string) => {
    if (raw === undefined || raw.trim() === "") throw new Error(`falta ${name}`);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${name} tiene que estar entre 0 y 100 (es "${raw}")`);
    const bps = Math.round(n * 100);
    if (Math.abs(n * 100 - bps) > 1e-6) throw new Error(`${name} admite hasta 2 decimales`);
    return BigInt(bps);
  };
  try {
    const bps = { ahorro: one("TILDAI_SAVINGS_PCT", env.savings), impuestos: one("TILDAI_TAXES_PCT", env.taxes) };
    if (bps.ahorro + bps.impuestos > 10_000n) throw new Error("ahorro + impuestos suman más de 100%");
    return { ok: true, bps };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * After the daily summary: sets aside savings and taxes from what was sold and confirmed today (Argentine day), never more than operating().
 * Ids are 'cierre:<fecha AR>:ahorro|impuestos', so a repeated or retried cierre sets nothing aside twice. Never retries in a loop and stops at the first error.
 * shortcut: if a run died between the two buckets, the retry caps the base to the (already reduced) operating; raise it to a per-day ledger when vaults hold more than a day's sales.
 */
export async function apartadoCierre(a: {
  book: SalesBook;
  ops: Pick<VaultOps, "apartar">;
  balances: () => Promise<{ operating: bigint; paused: boolean }>;
  env: { savings?: string; taxes?: string };
}): Promise<{ texto: string; records: OpRecord[] }> {
  const fail = (msg: string) => ({ texto: `No aparté nada: ${msg}`, records: [] as OpRecord[] });
  const pcts = parsePcts(a.env);
  if (!pcts.ok) return fail(pcts.error);

  const day = a.book.today();
  const fecha = diaISO(day);
  const vendido = a.book.stats(day).total;
  if (vendido === 0n) return fail("no hubo ventas confirmadas hoy.");

  let bal;
  try {
    bal = await a.balances();
  } catch (err) {
    console.error("[tildai] ALERTA cierre: no se pudo leer el vault", err);
    return fail(`no pude leer el vault (${(err as Error).message}).`);
  }
  if (bal.paused) {
    console.error("[tildai] ALERTA cierre: vault pausado, no se aparta");
    return fail("el vault está pausado.");
  }

  const base = vendido < bal.operating ? vendido : bal.operating;
  const lineas = [`Base para apartar: ${formatPesos(base)}${base < vendido ? ` (recortada: lo vendido fue ${formatPesos(vendido)} y el operativo no alcanza)` : ""}`];
  const records: OpRecord[] = [];
  for (const bucket of ["ahorro", "impuestos"] as BucketName[]) {
    const monto = (base * pcts.bps[bucket]) / 10_000n; // floor
    if (monto === 0n) {
      lineas.push(`${bucket}: nada que apartar`);
      continue;
    }
    const r = await a.ops.apartar(`cierre:${fecha}:${bucket}`, bucket, monto);
    records.push(r);
    lineas.push(`${bucket}: ${formatPesos(monto)} ${r.resultado === "ejecutada" ? "apartados" : r.resultado === "ya_ejecutada" ? "ya estaban apartados" : `NO se pudo apartar (${r.error})`}`);
    if (r.resultado === "error") {
      lineas.push("Corté acá y no reintento solo: revisalo.");
      break;
    }
  }
  return { texto: lineas.join("\n"), records };
}

/**
 * Daily close for every registered vault, one message per chat. A failure in one close is logged and reported
 * to that chat, and the rest still run. Idempotency is unchanged: apartadoCierre reuses 'cierre:<fecha AR>:<bucket>' opIds per vault.
 */
export async function cierreDeTodos(a: {
  jobs: { chatId: string; vault: { address: Address; fromBlock: bigint } }[];
  datos: (v: { address: Address; fromBlock: bigint }) => { book: SalesBook; balances: () => Promise<{ operating: bigint; paused: boolean }> };
  ops: (address: Address) => Pick<VaultOps, "apartar">;
  env: { savings?: string; taxes?: string };
  send: (chatId: string, texto: string) => unknown;
  /** With an indexer, the ranged /payments call gates the close: a failure or 503 means incomplete data, never a partial amount to move money with. */
  indexer?: Indexer;
}): Promise<void> {
  for (const j of a.jobs) {
    let sinFecha = 0;
    try {
      const { book, balances } = a.datos(j.vault);
      if (a.indexer) {
        try {
          await ventasDelDia(a.indexer, j.vault.address, book.today());
          // The ranged call leaves out pruned-block payments (timestampUnavailable): count them apart with
          // the unranged read so the close says they didn't enter the day's total. Their date is never guessed.
          sinFecha = (await a.indexer.pagosDelVault(j.vault.address)).filter((p) => p.timestampUnavailable).length;
        } catch (err) {
          console.error(`[tildai] ALERTA cierre del chat ${j.chatId}: indexer sin datos completos`, err);
          await a.send(j.chatId, "El cierre de caja de hoy quedó pendiente: el indexer todavía no tiene los datos completos (o está caído); reintenta solo. No aparté nada.");
          continue;
        }
      }
      const { resumen, verificado } = await cierreCaja(book);
      let apartado: string;
      if (!verificado) {
        apartado = "No aparté nada: las ventas de hoy todavía no se pudieron verificar.";
      } else {
        try {
          apartado = (await apartadoCierre({ book, ops: a.ops(j.vault.address), balances, env: a.env })).texto;
        } catch (err) {
          console.error(`[tildai] ALERTA cierre: falló el apartado del chat ${j.chatId}`, err);
          apartado = `No aparté nada: ${(err as Error).message}`;
        }
      }
      const notaSinFecha = sinFecha ? `\n\nOjo: hay ${sinFecha === 1 ? "un pago" : `${sinFecha} pagos`} sin fecha (son de bloques que el nodo ya no tiene) que no ${sinFecha === 1 ? "entró" : "entraron"} en el total de hoy.` : "";
      await a.send(j.chatId, `${resumen}\n\nApartado:\n${apartado}${notaSinFecha}`);
    } catch (err) {
      console.error(`[tildai] ALERTA cierre del chat ${j.chatId}: ${(err as Error).message}`, err);
      try {
        await a.send(j.chatId, `El cierre de caja de hoy falló y hay que revisarlo: ${(err as Error).message}`);
      } catch (e2) {
        console.error(`[tildai] ALERTA cierre: tampoco se pudo avisar al chat ${j.chatId}`, e2);
      }
    }
  }
}
