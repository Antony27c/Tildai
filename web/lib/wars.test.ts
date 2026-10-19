import test from "node:test";
import assert from "node:assert/strict";
import { choosePayOption, GENERIC, hasWallet, mapPayError, NO_BALANCE, REJECTED, UNCONFIRMED, warsAtomic } from "./wars.ts";
import { checkWarsWallet, readPayResponse, retriable } from "./buyer.ts";

const provider = (accounts: string[]) => ({ request: async ({ method }: { method: string }) => (method === "eth_accounts" ? accounts : undefined) });
const pc = (bal: bigint) => ({ readContract: async () => bal });

test("hasWallet: solo providers con request()", () => {
  assert.equal(hasWallet({ request: async () => [] }), true);
  assert.equal(hasWallet(undefined), false);
  assert.equal(hasWallet({}), false);
  assert.equal(hasWallet(null), false);
});

test("choosePayOption: wARS si alcanza o falta conectar; pesos en el resto", () => {
  assert.equal(choosePayOption("enough"), "wars");
  assert.equal(choosePayOption("no_accounts"), "wars");
  for (const c of ["no_wallet", "insufficient", "error"] as const) assert.equal(choosePayOption(c), "pesos");
});

test("checkWarsWallet sin monto no tira ni lee saldo (QR fijo)", async () => {
  assert.equal(await checkWarsWallet(provider(["0xabc"]), undefined, pc(0n)), "enough");
  assert.equal(await checkWarsWallet(provider([]), undefined), "no_accounts");
  assert.equal(await checkWarsWallet({}, 100), "no_wallet");
});

test("checkWarsWallet con monto compara saldo", async () => {
  const wallet = provider(["0xabc"]);
  assert.equal(await checkWarsWallet(wallet, 100, pc(200n * 10n ** 18n)), "enough");
  assert.equal(await checkWarsWallet(wallet, 100, pc(50n * 10n ** 18n)), "insufficient");
  assert.equal(await checkWarsWallet(wallet, 100, { readContract: async () => { throw new Error("rpc"); } }), "error");
});

test("mapPayError: errores en criollo sin detalle técnico", () => {
  assert.equal(mapPayError(new Error("User rejected the request")), REJECTED);
  assert.equal(mapPayError(Object.assign(new Error("denied"), { code: 4001 })), REJECTED);
  assert.equal(mapPayError(new Error("insufficient funds")), NO_BALANCE);
  assert.equal(mapPayError(new Error("No pudimos confirmar la liquidación (verificá onchain antes de reintentar)")), UNCONFIRMED);
  assert.equal(mapPayError(new Error("permit2_allowance_required")), GENERIC);
  assert.equal(mapPayError(new Error("All payment requirements were rejected by spendControls")), GENERIC);
  assert.equal(mapPayError("algo raro"), GENERIC);
});

test("warsAtomic: 18 decimales y monto inválido tira", () => {
  assert.equal(warsAtomic(8500.5), "8500500000000000000000");
  assert.equal(warsAtomic(1), "1000000000000000000");
  assert.throws(() => warsAtomic(0));
});

test("retriable: solo 402 que no sean settle indeterminado", () => {
  assert.equal(retriable(402, "permit nonce usado"), true);
  assert.equal(retriable(402, "No pudimos confirmar la liquidación (verificá onchain antes de reintentar)"), false);
  assert.equal(retriable(200), false);
  assert.equal(retriable(500), false);
});

test("readPayResponse: 200 sin txHash es pendiente, nunca 'no se te debitó'", async () => {
  assert.deepEqual(readPayResponse(200, { txHash: "0xabc" }), { ok: true, txHash: "0xabc" });
  assert.deepEqual(readPayResponse(200, {}), { ok: true, pending: true });
  });
