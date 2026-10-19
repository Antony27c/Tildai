import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedVault } from "./vaults.ts";

const a = "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d";
const b = "0x000000000000000000000000000000000000dEaD";

test("solo acepta vaults de la lista (sin importar mayúsculas)", () => {
  const env = { TILDAI_VAULTS: ` ${a.toUpperCase().replace("0X", "0x")} , ` };
  assert.equal(isAllowedVault(a, env), true);
  assert.equal(isAllowedVault(b, env), false);
});

test("sin lista ni demo rechaza todo; direcciones inválidas siempre", () => {
  assert.equal(isAllowedVault(a, {}), false);
  assert.equal(isAllowedVault(undefined, { TILDAI_DEMO: "1" }), false);
  assert.equal(isAllowedVault("0x123", { TILDAI_DEMO: "1" }), false);
});

test("TILDAI_DEMO=1 permite cualquier vault válido", () => {
  assert.equal(isAllowedVault(b, { TILDAI_DEMO: "1" }), true);
  assert.equal(isAllowedVault(b, { TILDAI_DEMO: "0" }), false);
});
