import test from "node:test";
import assert from "node:assert/strict";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload } from "@x402/core/types";
import { buildRequirements, facilitatorFromEnv, payWithX402 as pay, requirementsFor, WARS, x402Unavailable } from "./x402.ts";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const mainnet = { TILDAI_CHAIN_ID: "42220" };
const payWithX402 = (v: string, a: number, p: PaymentPayload, f: FacilitatorClient | null) => pay(v, a, p, f, mainnet);
const vault = "0x498450FE2b46F6b380857b2DE20Df7D52D17F18B";

function fake(over: Partial<FacilitatorClient> = {}): FacilitatorClient {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" }],
      extensions: ["eip2612GasSponsoring"],
      signers: {},
    }),
    verify: async () => ({ isValid: true, payer: "0xPayer" }),
    settle: async () => ({ success: true, transaction: "0xabc", network: "eip155:42220", payer: "0xPayer" }),
    ...over,
  };
}

async function req(amount = 8500.5) {
  return buildRequirements(new x402ResourceServer(fake()).register("eip155:*", new ExactEvmScheme()), vault, amount);
}
const payment = async (amount?: number): Promise<PaymentPayload> => ({ x402Version: 2, accepted: await req(amount), payload: {} });

test("requerimiento Permit2: wARS, payTo = vault, 18 decimales", async () => {
  const r = await req(8500.5);
  assert.equal(r.scheme, "exact");
  assert.equal(r.network, "eip155:42220");
  assert.equal(r.asset, WARS);
  assert.equal(r.payTo, vault);
  assert.equal(r.amount, "8500500000000000000000");
  assert.equal(r.extra.assetTransferMethod, "permit2");
  assert.equal(r.extra.name, "Peso Argentino");
  assert.equal(r.extra.version, "1");
});

test("sin API key: rechazado, sin llamar a nadie", async () => {
  assert.equal(facilitatorFromEnv({}), null);
  const r = await payWithX402(vault, 8500.5, await payment(), null);
  assert.deepEqual(r, { status: "rejected", code: "unavailable" });
  await assert.rejects(requirementsFor(vault, 1, null), /X402_API_KEY/);
});

test("facilitador acepta y liquida: pagado con el hash real", async () => {
  assert.deepEqual(await payWithX402(vault, 8500.5, await payment(), fake()), { status: "paid", txHash: "0xabc", payer: "0xPayer" });
});

test("el facilitador rechaza la verificación: code invalid, sin texto crudo", async () => {
  const f = fake({ verify: async () => ({ isValid: false, invalidReason: "permit2_allowance_required" }) });
  assert.deepEqual(await payWithX402(vault, 8500.5, await payment(), f), { status: "rejected", code: "invalid" });
});

test("falla la liquidación o el facilitador se cae: code not_settled / facilitator_error", async () => {
  const bad = fake({ settle: async () => ({ success: false, errorReason: "insufficient_credits", transaction: "", network: "eip155:42220" }) });
  // insufficient_credits es nuestro saldo: al cliente llega el código, no el motivo
  assert.deepEqual(await payWithX402(vault, 8500.5, await payment(), bad), { status: "rejected", code: "not_settled" });
  const down = fake({ verify: async () => { throw new Error("timeout"); } });
  assert.deepEqual(await payWithX402(vault, 8500.5, await payment(), down), { status: "rejected", code: "facilitator_error" });
});

test("error durante settle: indeterminado (la plata pudo moverse)", async () => {
  const f = fake({ settle: async () => { throw new Error("timeout"); } });
  assert.deepEqual(await payWithX402(vault, 8500.5, await payment(), f), { status: "rejected", code: "indeterminate" });
});

test("pago por otro monto o vault: rechazado sin verificar", async () => {
  let called = false;
  const f = fake({ verify: async () => ((called = true), { isValid: true }) });
  assert.deepEqual(await payWithX402(vault, 100, await payment(8500.5), f), { status: "rejected", code: "invalid" });
  assert.equal(called, false);
});

test("monto o vault inválidos: invalid sin tocar el facilitador", async () => {
  let called = false;
  const f = fake({ getSupported: async () => ((called = true), { kinds: [], extensions: [], signers: {} }) });
  assert.deepEqual(await payWithX402(vault, 0, await payment(), f), { status: "rejected", code: "invalid" });
  assert.deepEqual(await payWithX402("0x123", 5, await payment(), f), { status: "rejected", code: "invalid" });
  assert.equal(called, false);
});

test("el servidor se crea e inicializa una sola vez por facilitador", async () => {
  let inits = 0;
  const f = fake({
    getSupported: async () => (
      inits++,
      { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" }], extensions: ["eip2612GasSponsoring"], signers: {} }
    ),
  });
  assert.equal((await payWithX402(vault, 100, await payment(100), f)).status, "paid");
  assert.equal((await payWithX402(vault, 100, await payment(100), f)).status, "paid");
  assert.equal(inits, 1);
});

test("la API key viaja como X-API-Key al facilitador (supported, verify, settle)", async () => {
  const sent: Record<string, string | null> = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    const key = new Headers(init?.headers).get("x-api-key");
    if (url.endsWith("/supported")) {
      sent.supported = key;
      return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" }], extensions: [], signers: {} });
    }
    if (url.endsWith("/verify")) {
      sent.verify = key;
      return Response.json({ isValid: true, payer: "0xPayer" });
    }
    if (url.endsWith("/settle")) {
      sent.settle = key;
      return Response.json({ success: true, transaction: "0xabc", network: "eip155:42220", payer: "0xPayer" });
    }
    throw new Error("fetch inesperado: " + url);
  }) as typeof fetch;
  try {
    const f = facilitatorFromEnv({ X402_API_KEY: "x402_test_key" });
    assert.ok(f);
    const r = await payWithX402(vault, 8500.5, await payment(), f);
    assert.equal(r.status, "paid");
    assert.equal(sent.supported, "x402_test_key");
    assert.equal(sent.verify, "x402_test_key");
    assert.equal(sent.settle, "x402_test_key");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("TILDAI_CHAIN_ID distinto de 42220 (o ausente): x402 rechazado sin tocar al facilitador", async () => {
  let called = false;
  const f = fake({ verify: async () => ((called = true), { isValid: true }) });
  for (const env of [{ TILDAI_CHAIN_ID: "11142220" }, {}, { TILDAI_DEMO: "1" }]) {
    assert.deepEqual(await pay(vault, 8500.5, await payment(), f, env), { status: "rejected", code: "unavailable" });
    assert.match(x402Unavailable(env)!, /42220/);
  }
  assert.equal(called, false);
  assert.equal(x402Unavailable(mainnet), null);
});
