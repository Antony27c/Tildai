import test from "node:test";
import assert from "node:assert/strict";
import { dayRangeAR, fetchPanel, formatHoraAR, formatPesos, readVaultBalance, summarize } from "./panel.ts";
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

test("formatPesos: wei (18 dec) a pesos es-AR, sin float", () => {
  assert.equal(formatPesos("0"), "0,00");
  assert.equal(formatPesos("1500000000000000000"), "1,50");
  assert.equal(formatPesos("12345678900000000000000"), "12.345,68");
  assert.equal(formatPesos("1005000000000000000"), "1,01"); // redondea al centavo, no trunca
  assert.equal(formatPesos(5n * 10n ** 17n), "0,50");
});

test("formatHoraAR: hora argentina en HH:MM", () => {
  assert.equal(formatHoraAR(0), "21:00"); // epoch UTC = 21:00 AR del día anterior
  assert.match(formatHoraAR(Date.UTC(2026, 9, 19, 15, 7)), /^12:07$/);
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
