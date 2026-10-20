import test from "node:test";
import assert from "node:assert/strict";
import { checkVault } from "./vaults.ts";

// isVault se cachea por chain+vault: cada test usa una dirección distinta
const vault = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const env = { TILDAI_FACTORY: "0x963c9f2b54d765d74d8e1bd13f801b515ed44413", TILDAI_CHAIN_ID: "11142220" };

test("isVault true: ok, y consulta la factory con el vault", async () => {
  const v = vault(1);
  let args: any;
  const r = await checkVault(v, env, { readContract: async (a) => ((args = a), true) });
  assert.deepEqual(r, { status: "ok" });
  assert.equal(args.address, env.TILDAI_FACTORY);
  assert.equal(args.functionName, "isVault");
  assert.deepEqual(args.args, [v]);
});

test("isVault false: inválido", async () => {
  assert.deepEqual(await checkVault(vault(2), env, { readContract: async () => false }), { status: "invalid" });
});

test("error de RPC: error, nunca ok", async () => {
  const r = await checkVault(vault(3), env, { readContract: async () => { throw new Error("rpc caído"); } });
  assert.deepEqual(r, { status: "error", reason: "rpc caído" });
});

test("sin factory configurada: error", async () => {
  assert.equal((await checkVault(vault(4), {}, { readContract: async () => true })).status, "error");
});

test("dirección inválida o ausente: inválido, sin tocar la cadena", async () => {
  const boom = { readContract: async () => { throw new Error("no debería llamarse"); } };
  assert.deepEqual(await checkVault("0x123", env, boom), { status: "invalid" });
  assert.deepEqual(await checkVault(undefined, { TILDAI_DEMO: "1" }, boom), { status: "invalid" });
});

test("TILDAI_DEMO=1 permite cualquier vault válido sin cadena, jamás en mainnet", async () => {
  assert.deepEqual(await checkVault(vault(5), { TILDAI_DEMO: "1" }), { status: "ok" });
  assert.equal((await checkVault(vault(6), { ...env, TILDAI_DEMO: "0" }, { readContract: async () => false })).status, "invalid");
  // demo + mainnet: el modo demo no aplica, isVault se consulta de verdad
  const demoMainnet = { TILDAI_DEMO: "1", TILDAI_CHAIN_ID: "42220", TILDAI_FACTORY: env.TILDAI_FACTORY };
  assert.equal((await checkVault(vault(7), demoMainnet, { readContract: async () => false })).status, "invalid");
});

test("isVault true se cachea por chain: una sola consulta a la factory", async () => {
  let calls = 0;
  const reader = { readContract: async () => (calls++, true) };
  const cached = vault(8);
  assert.deepEqual(await checkVault(cached, env, reader), { status: "ok" });
  assert.deepEqual(await checkVault(cached.toLowerCase(), env, reader), { status: "ok" });
  assert.equal(calls, 1);
  // el cache es por chain: otra chain vuelve a consultar
  assert.deepEqual(await checkVault(cached, { ...env, TILDAI_CHAIN_ID: "42220" }, reader), { status: "ok" });
  assert.equal(calls, 2);
});
