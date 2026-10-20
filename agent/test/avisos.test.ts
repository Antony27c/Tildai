import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Address } from "viem";

import { avisarEventos, EventCursor, MAX_REINTENTOS_AVISO } from "../src/avisos.ts";
import { indexerClient, IndexerVault, ventasDelDia, type Indexer, type IndexerEvent, type IndexerPayment } from "../src/indexerClient.ts";
import { pesosToWei } from "../src/money.ts";
import { dayIndex, rangoDia, SalesBook } from "../src/sales.ts";

const V1 = "0x00000000000000000000000000000000000000a1" as Address;
const V2 = "0x00000000000000000000000000000000000000a2" as Address;

const pago = (id: string, pesos: number, timestamp: number | null = 1_700_000_000_000): IndexerPayment => ({
  id,
  from: "0xabc",
  amount: pesosToWei(pesos).toString(),
  txHash: `0x${id}`,
  timestamp,
});

const ev = (seq: number, type: IndexerEvent["type"], p: IndexerPayment | null): IndexerEvent => ({
  seq,
  type,
  paymentId: p?.id ?? `lost-${seq}`,
  payment: p,
});

function fakeIndexer(o: { events?: IndexerEvent[]; payments?: Map<string, IndexerPayment[]>; eventosError?: Error & { status?: number } }) {
  const calls: string[] = [];
  const indexer: Indexer = {
    async eventosDesde(cursor: number) {
      calls.push(`events?since=${cursor}`);
      if (o.eventosError) throw o.eventosError;
      const events = (o.events ?? []).filter((e) => e.seq > cursor);
      return { events, cursor: events.at(-1)?.seq ?? cursor };
    },
    async pagosDelVault(vault: string, range?: { since: number; until: number }) {
      calls.push(`payments?vault=${vault}${range ? `&since=${range.since}&until=${range.until}` : ""}`);
      const list = o.payments?.get(vault.toLowerCase()) ?? [];
      return range ? list.filter((p) => p.timestamp != null && p.timestamp >= range.since && p.timestamp < range.until) : list;
    },
  };
  return { indexer, calls };
}

const silenciar = () => {
  const orig = console.error;
  console.error = () => {};
  return () => {
    console.error = orig;
  };
};

test("avisos: cada evento al chat de su vault, en orden y en es-AR", async () => {
  const { indexer } = fakeIndexer({
    events: [ev(1, "venta_cobrada", pago("p1", 8500)), ev(2, "pago_sin_venta", pago("p2", 300))],
    payments: new Map([
      [V1.toLowerCase(), [pago("p1", 8500)]],
      [V2.toLowerCase(), [pago("p2", 300)]],
    ]),
  });
  const sent: { chatId: string; texto: string }[] = [];
  const cursor = EventCursor.load(undefined);
  await avisarEventos({
    indexer,
    cursor,
    vaults: [
      { chatId: "c1", vault: V1 },
      { chatId: "c2", vault: V2 },
    ],
    send: (chatId, texto) => sent.push({ chatId, texto }),
  });
  assert.deepEqual(sent, [
    { chatId: "c1", texto: "Entró una venta: $8.500 ✓" },
    { chatId: "c2", texto: "Te llegó un pago de $300 sin venta asociada" },
  ]);
  assert.equal(cursor.cursor, 2);
});

test("x402: pago_sin_venta y después venta_cobrada del mismo pago avisan los dos", async () => {
  const p = pago("p1", 8500);
  const { indexer } = fakeIndexer({ events: [ev(1, "pago_sin_venta", p), ev(2, "venta_cobrada", p)], payments: new Map([[V1.toLowerCase(), [p]]]) });
  const sent: string[] = [];
  const cursor = EventCursor.load(undefined);
  await avisarEventos({ indexer, cursor, vaults: [{ chatId: "c1", vault: V1 }], send: (_c, t) => sent.push(t) });
  assert.deepEqual(sent, ["Te llegó un pago de $8.500 sin venta asociada", "Entró una venta: $8.500 ✓"]);
  assert.equal(cursor.cursor, 2);
});

test("un chat que bloqueó al bot (error permanente) queda inactivo con ALERTA y el resto sigue", async () => {
  const pa = pago("pa", 100);
  const pb = pago("pb", 200);
  const { indexer } = fakeIndexer({
    events: [ev(1, "venta_cobrada", pa), ev(2, "venta_cobrada", pb)],
    payments: new Map([[V1.toLowerCase(), [pa]], [V2.toLowerCase(), [pb]]]),
  });
  const cursor = EventCursor.load(undefined);
  const sentB: string[] = [];
  const errores: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errores.push(String(a[0]));
  const send = async (chat: string, t: string) => {
    if (chat === "A") throw new Error("Forbidden: bot was blocked by the user");
    sentB.push(t);
  };
  try {
    for (let i = 0; i < 5; i++) {
      await avisarEventos({ indexer, cursor, vaults: [{ chatId: "A", vault: V1 }, { chatId: "B", vault: V2 }], send }).catch(() => {});
    }
  } finally {
    console.error = orig;
  }
  assert.equal(sentB.length, 1, "tras 5 pasadas el comercio B nunca recibió su venta");
  assert.match(sentB[0], /Entró una venta: \$200/);
  assert.equal(cursor.cursor, 2);
  assert.ok(errores.some((e) => /ALERTA.*chat A/.test(e)), "la desactivación del chat no se logueó como ALERTA");
});

test("error transitorio: reintenta con backoff y tras el tope salta el evento con ALERTA", async () => {
  let t = 0;
  const pa = pago("pa", 100);
  const pb = pago("pb", 200);
  const { indexer } = fakeIndexer({
    events: [ev(1, "venta_cobrada", pa), ev(2, "venta_cobrada", pb)],
    payments: new Map([[V1.toLowerCase(), [pa]], [V2.toLowerCase(), [pb]]]),
  });
  const cursor = EventCursor.load(undefined);
  const sent: string[] = [];
  const orig = console.error;
  console.error = () => {};
  const send = async (chat: string, txt: string) => {
    if (chat === "A") throw new Error("telegram caído (500)");
    sent.push(txt);
  };
  try {
    for (let i = 0; i < MAX_REINTENTOS_AVISO + 2; i++) {
      await avisarEventos({ indexer, cursor, vaults: [{ chatId: "A", vault: V1 }, { chatId: "B", vault: V2 }], send, now: () => t }).catch(() => {});
      t += 31 * 60_000; // más que el tope del backoff (30m): cada pasada habilita un reintento
    }
  } finally {
    console.error = orig;
  }
  // El evento 1 agotó sus reintentos y se saltó; el 2 llegó a su chat en esa misma pasada.
  assert.equal(cursor.cursor, 2);
  assert.deepEqual(sent, ["Entró una venta: $200 ✓"]);
});

test("rangoDia: bordes de medianoche AR", () => {
  const t = Date.UTC(2026, 9, 19, 3);
  const r = rangoDia(dayIndex(t));
  assert.equal(r.since, t);
  assert.equal(r.until, t + 86_400_000);
  assert.equal(rangoDia(dayIndex(t - 1)).until, t);
});

test("formato: 8.500 pesos en es-AR", async () => {
  const p = pago("pc", 8500);
  const sent: string[] = [];
  await avisarEventos({ indexer: fakeIndexer({ events: [ev(1, "venta_cobrada", p)], payments: new Map([[V1.toLowerCase(), [p]]]) }).indexer, cursor: EventCursor.load(undefined), vaults: [{ chatId: "A", vault: V1 }], send: async (_c, t) => { sent.push(t); } });
  assert.match(sent[0], /8\.500/);
});

test("si Telegram falla el cursor no avanza y el reintento reparte desde ahí", async () => {
  const pagos = new Map([[V1.toLowerCase(), [pago("p1", 100), pago("p2", 200)]]]);
  const { indexer } = fakeIndexer({ events: [ev(1, "venta_cobrada", pago("p1", 100)), ev(2, "venta_cobrada", pago("p2", 200))], payments: pagos });
  const cursor = EventCursor.load(undefined);
  const sent: string[] = [];
  let n = 0;
  const send = async (_c: string, t: string) => {
    if (++n === 2) throw new Error("telegram caído");
    sent.push(t);
  };
  await assert.rejects(() => avisarEventos({ indexer, cursor, vaults: [{ chatId: "c1", vault: V1 }], send }), /telegram caído/);
  assert.equal(cursor.cursor, 1); // solo el primero quedó avisado
  await avisarEventos({ indexer, cursor, vaults: [{ chatId: "c1", vault: V1 }], send });
  assert.deepEqual(sent, ["Entró una venta: $100 ✓", "Entró una venta: $200 ✓"]);
  assert.equal(cursor.cursor, 2);
});

test("reinicio: retoma desde el cursor persistido sin repetir ni saltear", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-ev-"));
  const file = join(dir, "eventos.json");
  const pagos = new Map([[V1.toLowerCase(), [pago("p1", 100), pago("p2", 200)]]]);
  const vaults = [{ chatId: "c1", vault: V1 }];
  const sent: string[] = [];
  const send = (_c: string, t: string) => sent.push(t);

  const i1 = fakeIndexer({ events: [ev(1, "venta_cobrada", pago("p1", 100))], payments: pagos });
  await avisarEventos({ indexer: i1.indexer, cursor: EventCursor.load(file), vaults, send });

  // Otro proceso lee el archivo: solo procesa lo que vino después.
  const cursor2 = EventCursor.load(file);
  assert.equal(cursor2.cursor, 1);
  const i2 = fakeIndexer({ events: [ev(1, "venta_cobrada", pago("p1", 100)), ev(2, "venta_cobrada", pago("p2", 200))], payments: pagos });
  await avisarEventos({ indexer: i2.indexer, cursor: cursor2, vaults, send });
  assert.deepEqual(sent, ["Entró una venta: $100 ✓", "Entró una venta: $200 ✓"]);
  rmSync(dir, { recursive: true });
});

test("evento de un vault sin chat o sin pago: se loguea y la tanda sigue", async () => {
  const { indexer } = fakeIndexer({
    events: [ev(1, "pago_sin_venta", pago("px", 50)), ev(2, "venta_cobrada", null), ev(3, "venta_cobrada", pago("p1", 100))],
    payments: new Map([[V1.toLowerCase(), [pago("p1", 100)]]]),
  });
  const sent: string[] = [];
  const cursor = EventCursor.load(undefined);
  const volver = silenciar();
  try {
    await avisarEventos({ indexer, cursor, vaults: [{ chatId: "c1", vault: V1 }], send: (_c, t) => sent.push(t) });
  } finally {
    volver();
  }
  assert.deepEqual(sent, ["Entró una venta: $100 ✓"]);
  assert.equal(cursor.cursor, 3);
});

test("cursor rechazado por el indexer (400): vuelve a 0, los avisados evitan duplicar", async () => {
  const { indexer } = fakeIndexer({ eventosError: Object.assign(new Error("cursor mayor que el último evento"), { status: 400 }) });
  const cursor = EventCursor.load(undefined);
  cursor.cursor = 42;
  const volver = silenciar();
  try {
    await avisarEventos({ indexer, cursor, vaults: [], send: () => {} });
  } finally {
    volver();
  }
  assert.equal(cursor.cursor, 0);
});

test("ventasDelDia suma el día pidiendo el rango en ms al indexer", async () => {
  const day = dayIndex(1_700_000_000_000);
  const r = rangoDia(day);
  const { indexer, calls } = fakeIndexer({
    payments: new Map([[V1.toLowerCase(), [pago("p1", 100, r.since + 1000), pago("p2", 50, r.since + 2000), pago("px", 999, r.since - 1000)]]]),
  });
  const d = await ventasDelDia(indexer, V1, day);
  assert.deepEqual(d, { total: pesosToWei(150), count: 2 });
  assert.match(calls[0], new RegExp(`payments\\?vault=${V1.toLowerCase()}&since=${r.since}&until=${r.until}`));
});

test("IndexerVault: solo pagos con timestamp cuentan; el sin timestamp queda sin confirmar", async () => {
  const r = rangoDia(dayIndex(1_700_000_000_000));
  const { indexer } = fakeIndexer({
    payments: new Map([[V1.toLowerCase(), [pago("p1", 100, r.since + 1000), pago("sin-ts", 999, null)]]]),
  });
  const book = new SalesBook(new IndexerVault(V1, indexer), () => r.since + 5000);
  assert.equal((await book.reconcile()).verified, true);
  assert.equal(book.stats(dayIndex(r.since + 5000)).total, pesosToWei(100));
});

test("indexerClient: Bearer en cada request, paths bien armados y error con status", async () => {
  const reqs: { url: string; auth: unknown }[] = [];
  const client = indexerClient({
    baseUrl: "http://idx.test/",
    token: "tok",
    fetch: async (url: any, init: any) => {
      const u = String(url);
      reqs.push({ url: u, auth: init?.headers?.authorization });
      if (u.includes("/events")) return new Response(JSON.stringify({ events: [], cursor: 7 }), { status: 200 });
      return new Response(JSON.stringify({ error: "reintenta" }), { status: 503 });
    },
  });
  await client.eventosDesde(7);
  assert.equal(reqs[0].auth, "Bearer tok");
  assert.match(reqs[0].url, /\/events\?since=7$/);
  const err = await client.pagosDelVault(V1, { since: 1, until: 2 }).catch((e) => e);
  assert.equal(err.status, 503);
  assert.match(reqs[1].url, new RegExp(`/payments\\?vault=${V1.toLowerCase()}&since=1&until=2$`));
});
