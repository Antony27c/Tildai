import test from "node:test";
import assert from "node:assert/strict";
import { fetchStats, formatPesos, networkName, parseStats } from "./stats.ts";

const env = { TILDAI_INDEXER_URL: "http://indexer.test", TILDAI_INDEXER_TOKEN: "secreto-123" };
const valid = {
  vaults: 3, activeVaults7d: 2, payments: 17, salesCobradas: 17,
  warsReceived: "1234567890000000000000",
  paymentsWithoutTimestamp: 0,
  byDay: [
    { day: "2026-10-05", payments: 2, warsReceived: "1000000000000000000" },
    { day: "2026-10-06", payments: 0, warsReceived: "0" },
  ],
  generatedAt: "2026-10-19T12:00:00.000Z",
};

test("parseStats: acepta el contrato y rechaza cualquier campo faltante o mal formado", () => {
  assert.deepEqual(parseStats(valid), valid);
  assert.deepEqual(parseStats({ ...valid, byDay: [] }), { ...valid, byDay: [] }); // byDay vacío es válido
  for (const k of Object.keys(valid)) {
    assert.equal(parseStats({ ...valid, [k]: undefined }), null, `falta ${k}`);
  }
  assert.equal(parseStats(null), null);
  assert.equal(parseStats("stats"), null);
  assert.equal(parseStats({ ...valid, vaults: -1 }), null);
  assert.equal(parseStats({ ...valid, vaults: 1.5 }), null);
  assert.equal(parseStats({ ...valid, warsReceived: "12.5" }), null);
  assert.equal(parseStats({ ...valid, warsReceived: 123 }), null);
  assert.equal(parseStats({ ...valid, byDay: [{ day: "05/10/2026", payments: 1, warsReceived: "1" }] }), null);
  assert.equal(parseStats({ ...valid, byDay: [{ day: "2026-10-05", payments: "2", warsReceived: "1" }] }), null);
  // chainId es opcional: número o string numérico; otra cosa rompe la forma.
  assert.equal(parseStats({ ...valid, chainId: 42220 })?.chainId, 42220);
  assert.equal(parseStats({ ...valid, chainId: "11142220" })?.chainId, 11142220);
  assert.equal(parseStats({ ...valid, chainId: "celo" }), null);
  assert.equal(parseStats({ ...valid, chainId: null }), null);
});

test("formatPesos: wei a pesos es-AR con bigint, sin float", () => {
  assert.equal(formatPesos("0"), "$ 0,00");
  assert.equal(formatPesos("1"), "$ 0,00");
  assert.equal(formatPesos("1500000000000000000"), "$ 1,50");
  assert.equal(formatPesos("1234567890000000000000"), "$ 1.234,56"); // trunca, no redondea
  assert.equal(formatPesos("999999999999999999"), "$ 0,99");
});

test("fetchStats: GET /stats con Bearer, y el token queda en el servidor", async () => {
  let url = "", init: RequestInit | undefined;
  const f = (async (u: URL, i: RequestInit) => ((url = String(u)), (init = i), Response.json(valid))) as unknown as typeof fetch;
  const r = await fetchStats(env, f);
  assert.equal(r.ok, true);
  assert.equal(url, "http://indexer.test/stats");
  assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer secreto-123");
});

test("fetchStats: indexer caído, 500, formato inesperado o sin env → ok:false, nunca ceros", async () => {
  const down = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
  assert.equal((await fetchStats(env, down)).ok, false);
  const r500 = (async () => Response.json({}, { status: 500 })) as typeof fetch;
  assert.equal((await fetchStats(env, r500)).ok, false);
  const weird = (async () => Response.json({ vaults: 3 })) as typeof fetch;
  assert.equal((await fetchStats(env, weird)).ok, false);
  assert.equal((await fetchStats({}, weird)).ok, false);
});

test("networkName: sin default; vacío o desconocido → 'red no configurada'", () => {
  assert.equal(networkName(42220), "Celo mainnet");
  assert.equal(networkName("42220"), "Celo mainnet");
  assert.equal(networkName(11142220), "Celo Sepolia");
  assert.equal(networkName("11142220"), "Celo Sepolia");
  assert.equal(networkName(undefined), "red no configurada");
  assert.equal(networkName(""), "red no configurada");
  assert.equal(networkName("1"), "red no configurada");
});
