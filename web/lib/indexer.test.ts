import test from "node:test";
import assert from "node:assert/strict";
import { checkSalePending, getSaleStatus, notifyTx, reportPayment, saleStatusResponse } from "./indexer.ts";
import { pollSale } from "./poll.ts";

const env = { TILDAI_INDEXER_URL: "https://indexer.test", TILDAI_INDEXER_TOKEN: "secreto-123" };
const reply = (status: number, body: unknown = {}) => (async () => Response.json(body, { status })) as typeof fetch;
const silent = async <T>(fn: () => Promise<T>) => {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

test("notifyTx: POST /sales/:id/tx con Bearer y { txHash }", async () => {
  let url = "", init: any;
  const f = (async (u: URL, i: RequestInit) => ((url = String(u)), (init = i), Response.json({ id: "s1", status: "pendiente" }))) as unknown as typeof fetch;
  assert.deepEqual(await notifyTx("s1", "0xabc", env, f), { ok: true, status: "pendiente" });
  assert.equal(url, "https://indexer.test/sales/s1/tx");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer secreto-123");
  assert.deepEqual(JSON.parse(init.body), { txHash: "0xabc" });
});

test("notifyTx: 404, 409 y otros errores", async () => {
  assert.equal(((await notifyTx("s1", "0xabc", env, reply(404))) as any).code, "not_found");
  assert.equal(((await notifyTx("s1", "0xabc", env, reply(409))) as any).code, "conflict");
  assert.equal(((await notifyTx("s1", "0xabc", env, reply(500))) as any).code, "error");
  assert.equal(((await notifyTx("s1", "0xabc", {}, reply(200))) as any).code, "error");
});

test("indexer caído: reportPayment no tira, avisa y no dice cobrado", async () => {
  const down = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
  const aviso = await silent(() => reportPayment("s1", "0xabc", env, down));
  assert.match(aviso!, /pago se hizo/);
  assert.doesNotMatch(aviso!, /cobrad/i);
  for (const status of [404, 409, 500]) assert.ok(await silent(() => reportPayment("s1", "0xabc", env, reply(status))));
});

test("reportPayment: sin venta no llama; con éxito no hay aviso", async () => {
  const boom = (async () => { throw new Error("no debería llamarse"); }) as typeof fetch;
  assert.equal(await reportPayment(null, "0xabc", env, boom), undefined);
  assert.equal(await reportPayment("s1", "0xabc", env, reply(200, { id: "s1", status: "pendiente" })), undefined);
});

test("getSaleStatus: ok con vault y amount, 404 y caída", async () => {
  assert.deepEqual(await getSaleStatus("s1", env, reply(200, { id: "s1", status: "cobrada", vault: "0xv", amount: "100" })), {
    ok: true, status: "cobrada", vault: "0xv", amount: "100",
  });
  assert.equal(((await getSaleStatus("s1", env, reply(404))) as any).code, "not_found");
  assert.equal(((await getSaleStatus("s1", env, reply(503))) as any).code, "error");
});

test("la URL del indexer conserva el path base y exige https fuera de localhost", async () => {
  let url = "";
  const f = (async (u: URL) => ((url = String(u)), Response.json({ id: "s1", status: "pendiente" }))) as unknown as typeof fetch;
  const conPath = { TILDAI_INDEXER_URL: "https://host.test/indexer/", TILDAI_INDEXER_TOKEN: "t" };
  await notifyTx("s1", "0xabc", conPath, f);
  assert.equal(url, "https://host.test/indexer/sales/s1/tx");
  await notifyTx("s1", "0xabc", { TILDAI_INDEXER_URL: "http://localhost:3199", TILDAI_INDEXER_TOKEN: "t" }, f);
  assert.equal(url, "http://localhost:3199/sales/s1/tx");
  const http = { TILDAI_INDEXER_URL: "http://indexer.test", TILDAI_INDEXER_TOKEN: "t" };
  assert.equal(((await silent(() => notifyTx("s1", "0xabc", http, f))) as any).code, "error");
});

test("checkSalePending: solo pendiente con vault y monto exactos", async () => {
  const sale = { id: "s1", status: "pendiente", vault: "0xABCdef", amount: "850000" };
  assert.equal(await checkSalePending("s1", "0xabcdef", "850000", env, reply(200, sale)), "ok");
  assert.equal(await checkSalePending("s1", "0xabcdef", "850000", env, reply(200, { ...sale, status: "cobrada" })), "conflict");
  assert.equal(await checkSalePending("s1", "0xotro", "850000", env, reply(200, sale)), "conflict");
  assert.equal(await checkSalePending("s1", "0xabcdef", "1", env, reply(200, sale)), "conflict");
  assert.equal(await checkSalePending("s1", "0xabcdef", "850000", env, reply(404)), "conflict");
  const down = (async () => { throw new Error("caído"); }) as typeof fetch;
  assert.equal(await checkSalePending("s1", "0xabcdef", "850000", env, down), "unavailable");
});

test("/api/sale: al navegador solo { status }; el token y el resto no salen", async () => {
  const full = reply(200, { id: "s1", vault: "0xV", amount: "8500", status: "cobrada", txHash: "0xabc" });
  const res = await saleStatusResponse("s1", env, full);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "cobrada" });
  const err = await silent(() => saleStatusResponse("s1", env, (async () => { throw new Error("falló con secreto-123"); }) as typeof fetch));
  assert.equal(err.status, 503);
  assert.doesNotMatch(JSON.stringify(await err.json()), /secreto|Bearer/);
  assert.equal((await saleStatusResponse("s1", env, reply(404))).status, 404);
});

test("pollSale: cobrada, timeout y cancelación", async () => {
  let n = 0;
  const f = (async () => Response.json({ status: ++n < 3 ? "pendiente" : "cobrada" })) as typeof fetch;
  assert.equal(await pollSale("s1", { f, intervalMs: 1, maxMs: 1000 }), "cobrada");
  assert.equal(await pollSale("s1", { f: reply(200, { status: "pendiente" }), intervalMs: 1, maxMs: 20 }), "timeout");
  const net = (async () => { throw new Error("red"); }) as typeof fetch;
  assert.equal(await pollSale("s1", { f: net, intervalMs: 1, maxMs: 20 }), "timeout");
  const ctl = new AbortController();
  ctl.abort();
  assert.equal(await pollSale("s1", { f: reply(200, { status: "pendiente" }), intervalMs: 1, maxMs: 1000, signal: ctl.signal }), "cancelled");
});
