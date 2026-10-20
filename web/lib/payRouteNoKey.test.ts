import test from "node:test";
import assert from "node:assert/strict";

// Mainnet sin X402_API_KEY: /api/pay responde 503 claro, loguea una sola línea y no llama al facilitador.
Object.assign(process.env, {
  TILDAI_CHAIN_ID: "42220",
  TILDAI_FACTORY: "0x963c9f2b54d765d74d8e1bd13f801b515ed44413",
  TILDAI_RPC_URL: "http://rpc.test",
});
delete process.env.X402_API_KEY;
let facilitatorCalls = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://rpc.test")) {
    const b = JSON.parse(init?.body);
    const one = (x: any) => ({ jsonrpc: "2.0", id: x.id, result: "0x" + "0".repeat(63) + "1" });
    return Response.json(Array.isArray(b) ? b.map(one) : one(b));
  }
  if (url.includes("x402.celo.org")) facilitatorCalls++;
  return Response.json({});
}) as typeof fetch;

const { GET } = await import("../app/api/pay/route.ts");
const V = "0x6666666666666666666666666666666666666666";
const logs: string[] = [];
const origError = console.error;
console.error = (...a: any[]) => logs.push(a.join(" "));

test("sin X402_API_KEY en mainnet: 503 claro, 'falta X402_API_KEY' una vez, cero llamadas al facilitador", async () => {
  try {
    for (const ip of ["5.5.5.5", "5.5.5.6"]) {
      const r = await GET(new Request(`http://x/api/pay?vault=${V}&amount=8500`, { headers: { "x-forwarded-for": ip } }));
      assert.equal(r.status, 503);
      const body = await r.json();
      assert.match(body.error, /wARS/);
      assert.ok(!JSON.stringify(body).includes("X402_API_KEY"));
    }
    assert.equal(logs.filter((l) => l.includes("falta X402_API_KEY")).length, 1);
    assert.equal(facilitatorCalls, 0);
  } finally {
    console.error = origError;
  }
});
