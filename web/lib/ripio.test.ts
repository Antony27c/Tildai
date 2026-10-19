import test from "node:test";
import assert from "node:assert/strict";
import { buildRipioLink, parseAmount } from "./ripio.ts";

const vault = "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d";

test("arma el link de Ripio con los parámetros correctos", () => {
  assert.equal(
    buildRipioLink(8500, vault),
    `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=8500&address=${vault}`,
  );
});

test("rechaza vault o monto inválidos", () => {
  assert.throws(() => buildRipioLink(8500, "0x123"));
  assert.throws(() => buildRipioLink(0, vault));
  assert.throws(() => buildRipioLink(NaN, vault));
});

test("parseAmount sigue el formato argentino", () => {
  assert.equal(parseAmount("8.500"), 8500);
  assert.equal(parseAmount("8.500,50"), 8500.5);
  assert.equal(parseAmount("1.234.567"), 1234567);
  assert.equal(parseAmount("8500"), 8500);
  assert.equal(parseAmount("8,5"), 8.5);
  assert.equal(parseAmount("8.5"), 8.5);
});

test("parseAmount descarta basura", () => {
  for (const x of ["abc", "-5", "", "8.5.5", "1e3", "8,5,5", "0", undefined]) assert.equal(parseAmount(x), null, String(x));
});
