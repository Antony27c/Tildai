import test from "node:test";
import assert from "node:assert/strict";
import { byDay, dayRangeAR, fetchPanel, formatDiaHoraAR, formatHoraAR, formatPesos, parseDia, periodRangeAR, readVaultBalance, summarize } from "./panel.ts";
import { WARS } from "./wars.ts";

const DAY = 86_400_000;
const env = { TILDAI_INDEXER_URL: "http://indexer.test", TILDAI_INDEXER_TOKEN: "secreto-123" };
const vault = "0x498450FE2b46F6b380857b2DE20Df7D52D17F18B";
const silent = async <T>(fn: () => Promise<T>) => {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

test("dayRangeAR: el día empieza a las 00:00 en Argentina (UTC-3)", () => {
  // 02:00 UTC del 19 = 23:00 AR del 18 → el día AR es el 18, que arrancó 03:00 UTC del 18
  const r = dayRangeAR(Date.UTC(2026, 9, 19, 2));
  assert.equal(r.since, Date.UTC(2026, 9, 18, 3));
  assert.equal(r.until - r.since, DAY);
  assert.equal(dayRangeAR(Date.UTC(2026, 9, 19, 15)).since, Date.UTC(2026, 9, 19, 3));
  // exactamente medianoche AR del 19 (03:00 UTC) ya es el día 19; un ms antes sigue siendo el 18
  assert.equal(dayRangeAR(Date.UTC(2026, 9, 19, 3)).since, Date.UTC(2026, 9, 19, 3));
  assert.equal(dayRangeAR(Date.UTC(2026, 9, 19, 3) - 1).since, Date.UTC(2026, 9, 18, 3));
});

test("parseDia: solo hoy/ayer/7d; cualquier otra cosa cae en hoy", () => {
  assert.equal(parseDia("hoy"), "hoy");
  assert.equal(parseDia("ayer"), "ayer");
  assert.equal(parseDia("7d"), "7d");
  for (const x of [undefined, null, "", "HOY", "30d", "manana", "0"]) assert.equal(parseDia(x), "hoy");
});

test("periodRangeAR: ayer es el día anterior y 7d los últimos 7 con hoy incluido", () => {
  const now = Date.UTC(2026, 9, 19, 15); // 12:00 AR del 19
  const hoy = Date.UTC(2026, 9, 19, 3);
  assert.deepEqual(periodRangeAR("hoy", now), { since: hoy, until: hoy + DAY });
  assert.deepEqual(periodRangeAR("ayer", now), { since: hoy - DAY, until: hoy });
  assert.deepEqual(periodRangeAR("7d", now), { since: hoy - 6 * DAY, until: hoy + DAY });
});

test("periodRangeAR: borde de medianoche AR y cambio de mes", () => {
  // 01/10 02:00 UTC = 30/9 23:00 AR → "hoy" es 30/9, "ayer" 29/9, 7d arranca 24/9
  const now = Date.UTC(2026, 9, 1, 2);
  assert.equal(periodRangeAR("hoy", now).since, Date.UTC(2026, 8, 30, 3));
  assert.deepEqual(periodRangeAR("ayer", now), { since: Date.UTC(2026, 8, 29, 3), until: Date.UTC(2026, 8, 30, 3) });
  assert.equal(periodRangeAR("7d", now).since, Date.UTC(2026, 8, 24, 3));
  // 02:59:59 UTC del 1/10 = 30/9 23:59:59 AR → "ayer" es 29/9; a la medianoche AR exacta ya es 30/9
  assert.equal(periodRangeAR("ayer", Date.UTC(2026, 9, 1, 3) - 1).since, Date.UTC(2026, 8, 29, 3));
  assert.equal(periodRangeAR("ayer", Date.UTC(2026, 9, 1, 3)).since, Date.UTC(2026, 8, 30, 3));
});

test("byDay: una fila por día del rango, más nuevo primero, días vacíos en 0", () => {
  const { since, until } = periodRangeAR("7d", Date.UTC(2026, 9, 19, 15)); // 14/10..19/10 AR
  const p = (ts: number, amount: string, id: string) => ({ id, from: "0x1", amount, txHash: "0x" + id, timestamp: ts });
  const payments = [
    p(Date.UTC(2026, 9, 19, 12), "2000000000000000000", "a"), // 19/10 09:00 AR
    p(Date.UTC(2026, 9, 19, 2, 30), "1000000000000000000", "b"), // 18/10 23:30 AR → día 18
    p(Date.UTC(2026, 9, 19, 3), "500000000000000000", "c"), // exacto medianoche AR → día 19
    p(Date.UTC(2026, 9, 15, 20), "4000000000000000000", "d"), // 15/10 17:00 AR
    { ...p(0, "9000000000000000000", "e"), timestamp: null }, // sin timestamp: no se cuenta
  ];
  const days = byDay(payments, since, until);
  assert.equal(days.length, 7);
  assert.equal(days[0].daySince, Date.UTC(2026, 9, 19, 3));
  assert.equal(days[0].totalWei, 2500000000000000000n); // a + c
  assert.equal(days[0].count, 2);
  assert.equal(days[1].daySince, Date.UTC(2026, 9, 18, 3));
  assert.equal(days[1].totalWei, 1000000000000000000n); // b
  assert.equal(days[4].daySince, Date.UTC(2026, 9, 15, 3));
  assert.equal(days[4].totalWei, 4000000000000000000n); // d
  for (const i of [2, 3, 5, 6]) assert.deepEqual({ totalWei: days[i].totalWei, count: days[i].count }, { totalWei: 0n, count: 0 });
});

test("formatPesos: wei (18 dec) a pesos es-AR, trunca al centavo (sin float)", () => {
  assert.equal(formatPesos("0"), "0,00");
  assert.equal(formatPesos("1500000000000000000"), "1,50");
  assert.equal(formatPesos("12345678900000000000000"), "12.345,67");
  assert.equal(formatPesos("999000000000000000"), "0,99"); // 0,999 wARS → $0,99, nunca $1,00
  assert.equal(formatPesos("1005000000000000000"), "1,00"); // 1,005 → trunca a 1,00
  assert.equal(formatPesos(5n * 10n ** 17n), "0,50");
});

test("formatHoraAR y formatDiaHoraAR: hora argentina", () => {
  assert.equal(formatHoraAR(0), "21:00"); // epoch UTC = 21:00 AR del día anterior
  assert.equal(formatHoraAR(Date.UTC(2026, 9, 19, 15, 7)), "12:07");
  assert.equal(formatDiaHoraAR(Date.UTC(2026, 9, 19, 15, 7)), "19/10 12:07");
});

test("summarize: total en wei, cantidad de pagos, cobradas vs pendientes", () => {
  const sales = [
    { id: "a", amount: "1000000000000000000", status: "cobrada" as const, createdAt: 1 },
    { id: "b", amount: "2000000000000000000", status: "pendiente" as const, createdAt: 2 },
    { id: "c", amount: "3000000000000000000", status: "pendiente" as const, createdAt: 3 },
  ];
  const payments = [
    { id: "p1", from: "0x1", amount: "1500000000000000000", txHash: "0xaaa", timestamp: 10 },
    { id: "p2", from: "0x2", amount: "500000000000000000", txHash: "0xbbb", timestamp: 20 },
  ];
  const s = summarize(sales, payments);
  assert.equal(s.totalWei, 2000000000000000000n);
  assert.equal(s.pagos, 2);
  assert.equal(s.cobradas, 1);
  assert.equal(s.pendientes, 2);
  assert.deepEqual(summarize([], []), { totalWei: 0n, pagos: 0, cobradas: 0, pendientes: 0 });
});

test("fetchPanel: GET sales y payments con Bearer y rango en ms", async () => {
  const urls: string[] = [];
  let auth = "";
  const f = (async (u: URL, i: RequestInit) => {
    urls.push(String(u));
    auth = (i.headers as Record<string, string>).Authorization;
    return Response.json([]);
  }) as unknown as typeof fetch;
  const r = await fetchPanel(vault, 1000, 2000, env, f);
  assert.deepEqual(r, { ok: true, sales: [], payments: [] });
  assert.equal(urls[0], `http://indexer.test/sales?vault=${vault}&since=1000&until=2000`);
  assert.equal(urls[1], `http://indexer.test/payments?vault=${vault}&since=1000&until=2000`);
  assert.equal(auth, "Bearer secreto-123");
});

test("fetchPanel: 503 (pagos sin timestamp), caída y env faltante → ok:false", async () => {
  const payments503 = (async (u: URL) => Response.json({}, { status: String(u).includes("payments") ? 503 : 200 })) as typeof fetch;
  assert.equal((await silent(() => fetchPanel(vault, 0, 1, env, payments503))).ok, false);
  const down = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  assert.equal((await silent(() => fetchPanel(vault, 0, 1, env, down))).ok, false);
  assert.equal((await silent(() => fetchPanel(vault, 0, 1, {}, async () => Response.json([])))) .ok, false);
});

test("fetchPanel: fila malformada → ok:false (nunca totales inventados)", async () => {
  const rara = (async (u: URL) =>
    Response.json(String(u).includes("payments") ? [] : [{ id: "a", amount: "mucho", status: "cobrada", createdAt: 1 }])) as typeof fetch;
  assert.equal((await silent(() => fetchPanel(vault, 0, 1, env, rara))).ok, false);
});

test("readVaultBalance: bigint del contrato wARS; error → null (nunca $0 falso)", async () => {
  let seen: any;
  const ok = { readContract: async (a: any) => ((seen = a), 42000000000000000000n) };
  assert.equal(await readVaultBalance(vault, {}, ok), 42000000000000000000n);
  assert.equal(seen.address, WARS);
  assert.deepEqual(seen.args, [vault]);
  const roto = { readContract: async () => Promise.reject(new Error("rpc")) };
  assert.equal(await silent(() => readVaultBalance(vault, {}, roto)), null);
});
