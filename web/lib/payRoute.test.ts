import test from "node:test";
import assert from "node:assert/strict";

// Handler real de /api/pay con fetch falso: RPC (isVault), facilitador (/supported, verify, settle).
Object.assign(process.env, {
  TILDAI_CHAIN_ID: "42220",
  X402_API_KEY: "x402_test",
  TILDAI_FACTORY: "0x963c9f2b54d765d74d8e1bd13f801b515ed44413",
  TILDAI_RPC_URL: "http://rpc.test",
});
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://rpc.test")) {
    const b = JSON.parse(init?.body);
    const one = (x: any) => ({ jsonrpc: "2.0", id: x.id, result: "0x" + "0".repeat(63) + "1" });
    return Response.json(Array.isArray(b) ? b.map(one) : one(b));
  }
  if (url.endsWith("/supported")) {
    return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" }], extensions: [], signers: {} });
  }
  return Response.json({ isValid: false, invalidReason: "x" });
}) as typeof fetch;

const { GET } = await import("../app/api/pay/route.ts");
const sig = Buffer.from(JSON.stringify({ x402Version: 2, accepted: {}, payload: {} })).toString("base64");
const get = (vault: string, ip: string, signed: boolean) =>
  GET(new Request(`http://x/api/pay?vault=${vault}&amount=8500`, {
    headers: { "x-forwarded-for": ip, ...(signed ? { "PAYMENT-SIGNATURE": sig } : {}) },
  }));

const V1 = "0x6666666666666666666666666666666666666666";
const V2 = "0x7777777777777777777777777777777777777777";

test("3 clientes seguidos del mismo vault: el pago firmado no da 429", async () => {
  for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
    assert.equal((await get(V1, ip, false)).status, 402);
    // el facilitador falso rechaza la firma (402), pero nunca por rate limit
    assert.equal((await get(V1, ip, true)).status, 402);
  }
});

test("los GET sin firma no consumen el cupo firmado del vault", async () => {
  // 30 pedidos sin firma agotan u:vault (u:ip sigue OK porque son IPs distintas)
  for (let i = 0; i < 30; i++) assert.equal((await get(V2, `9.9.9.${i}`, false)).status, 402);
  assert.equal((await get(V2, "9.9.9.99", false)).status, 429);
  // el firmado usa s:vault: el comercio sigue pudiendo cobrar
  assert.equal((await get(V2, "9.9.9.99", true)).status, 402);
});
