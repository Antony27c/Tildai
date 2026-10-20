import test from "node:test";
import assert from "node:assert/strict";

// Handler real de /api/pay con fetch falso: RPC (isVault), indexer (/sales) y facilitador (/supported, verify, settle).
Object.assign(process.env, {
  TILDAI_CHAIN_ID: "42220",
  X402_API_KEY: "x402_test",
  TILDAI_FACTORY: "0x963c9f2b54d765d74d8e1bd13f801b515ed44413",
  TILDAI_RPC_URL: "http://rpc.test",
  TILDAI_INDEXER_URL: "http://127.0.0.1:3199/base",
  TILDAI_INDEXER_TOKEN: "tok_test",
});
const V1 = "0x6666666666666666666666666666666666666666";
const V2 = "0x7777777777777777777777777777777777777777";
const V3 = "0x8888888888888888888888888888888888888888";
let indexerCalls = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://rpc.test")) {
    const b = JSON.parse(init?.body);
    const one = (x: any) => ({ jsonrpc: "2.0", id: x.id, result: "0x" + "0".repeat(63) + "1" });
    return Response.json(Array.isArray(b) ? b.map(one) : one(b));
  }
  if (url.startsWith("http://127.0.0.1:3199/")) {
    indexerCalls++;
    if (url.endsWith("/sales/s1")) return Response.json({ status: "pendiente", vault: V3, amount: "8500000000000000000000" });
    return Response.json({ error: "nf" }, { status: 404 });
  }
  if (url.endsWith("/supported")) {
    return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" }], extensions: [], signers: {} });
  }
  return Response.json({ isValid: false, invalidReason: "x" });
}) as typeof fetch;

const { GET } = await import("../app/api/pay/route.ts");
const sig = Buffer.from(JSON.stringify({ x402Version: 2, accepted: {}, payload: {} })).toString("base64");
const get = (vault: string, ip: string, signed: boolean, extra = "") =>
  GET(new Request(`http://x/api/pay?vault=${vault}&amount=8500${extra}`, {
    headers: { "x-forwarded-for": ip, ...(signed ? { "PAYMENT-SIGNATURE": sig } : {}) },
  }));

test("3 clientes seguidos del mismo vault: el pago firmado no da 429", async () => {
  for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
    assert.equal((await get(V1, ip, false)).status, 402);
    // el facilitador falso rechaza la firma (402), pero nunca por rate limit
    assert.equal((await get(V1, ip, true)).status, 402);
  }
});

test("los GET sin firma desde una IP se limitan; el firmado tiene cupo propio", async () => {
  for (let i = 0; i < 30; i++) assert.equal((await get(V2, "9.9.9.9", false)).status, 402);
  assert.equal((await get(V2, "9.9.9.9", false)).status, 429);
  // el firmado usa s:ip/s:vault: sigue entrando
  assert.equal((await get(V2, "9.9.9.9", true)).status, 402);
});

test("100 GET sin firma de IPs distintas no bloquean el vault; el firmado pasa", async () => {
  for (let i = 0; i < 100; i++) {
    assert.equal((await get(V3, `8.8.${(i >> 8) & 255}.${i & 255}`, false)).status, 402);
  }
  assert.equal((await get(V3, "8.8.9.9", true)).status, 402);
});

test("GET sin firma con ?sale= cachea la validación unos segundos; el firmado valida fresco", async () => {
  const base = indexerCalls;
  for (let i = 0; i < 10; i++) {
    assert.equal((await get(V3, `7.7.7.${i}`, false, "&sale=s1")).status, 402);
  }
  assert.equal(indexerCalls - base, 1);
  // el pago firmado siempre consulta la venta fresco al indexer antes de liquidar
  assert.equal((await get(V3, "9.8.7.6", true, "&sale=s1")).status, 402);
  assert.equal(indexerCalls - base, 2);
});
