import test from "node:test";
import assert from "node:assert/strict";
import { choosePayOption, GENERIC, hasWallet, mapPayError, NO_BALANCE, REJECTED, UNCONFIRMED, warsAtomic } from "./wars.ts";

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
