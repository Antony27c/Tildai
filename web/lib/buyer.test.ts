import test from "node:test";
import assert from "node:assert/strict";
import { checkWarsWallet, isMiniPay, payWithWars } from "./buyer.ts";
import { choosePayOption, GENERIC } from "./wars.ts";

const minipay = (request?: () => Promise<unknown>) => ({ isMiniPay: true, request: request ?? (async () => []) });

test("isMiniPay: solo true con isMiniPay === true", () => {
  assert.equal(isMiniPay(minipay()), true);
  assert.equal(isMiniPay({ isMiniPay: false, request: async () => [] }), false);
  assert.equal(isMiniPay({ request: async () => [] }), false);
  assert.equal(isMiniPay(undefined), false);
  assert.equal(isMiniPay(null), false);
});

test("MiniPay: sin message signing no hay camino wARS, queda 'Pagar con pesos'", async () => {
  // el flujo x402 firma un permit Permit2 (eth_signTypedData_v4) que MiniPay no soporta
  assert.equal(await checkWarsWallet(minipay()), "no_wallet");
  assert.equal(choosePayOption(await checkWarsWallet(minipay())), "pesos");
});

test("MiniPay: payWithWars ni habla con la wallet", async () => {
  let calls = 0;
  const mp = minipay(async () => (calls++, []));
  const r = await payWithWars(mp, "0x1111111111111111111111111111111111111111", 8500, null);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, GENERIC);
  assert.equal(calls, 0);
});

test("wallet normal: eth_accounts decide entre wars y pesos", async () => {
  const sinCuentas = { request: async () => [] };
  assert.equal(await checkWarsWallet(sinCuentas), "no_accounts");
  assert.equal(choosePayOption("no_accounts"), "wars");
  const conCuenta = { request: async () => ["0x1111111111111111111111111111111111111111"] };
  assert.equal(await checkWarsWallet(conCuenta), "enough");
});
