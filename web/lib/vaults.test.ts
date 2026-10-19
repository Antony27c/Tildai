import test from "node:test";
import assert from "node:assert/strict";
import { checkVault } from "./vaults.ts";

const vault = "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d";
const env = { TILDAI_FACTORY: "0x963c9f2b54d765d74d8e1bd13f801b515ed44413", TILDAI_CHAIN_ID: "11142220" };

test("isVault true: ok, y consulta la factory con el vault", async () => {
  let args: any;
  const r = await checkVault(vault, env, { readContract: async (a) => ((args = a), true) });
  assert.deepEqual(r, { status: "ok" });
  assert.equal(args.address, env.TILDAI_FACTORY);
  assert.equal(args.functionName, "isVault");
  assert.deepEqual(args.args, [vault]);
});

test("isVault false: inválido", async () => {
  assert.deepEqual(await checkVault(vault, env, { readContract: async () => false }), { status: "invalid" });
});

test("error de RPC: error, nunca ok", async () => {
  const r = await checkVault(vault, env, { readContract: async () => { throw new Error("rpc caído"); } });
  assert.deepEqual(r, { status: "error", reason: "rpc caído" });
});

test("sin factory configurada: error", async () => {
  assert.equal((await checkVault(vault, {}, { readContract: async () => true })).status, "error");
});

test("dirección inválida o ausente: inválido, sin tocar la cadena", async () => {
  const boom = { readContract: async () => { throw new Error("no debería llamarse"); } };
  assert.deepEqual(await checkVault("0x123", env, boom), { status: "invalid" });
  assert.deepEqual(await checkVault(undefined, { TILDAI_DEMO: "1" }, boom), { status: "invalid" });
});

test("TILDAI_DEMO=1 permite cualquier vault válido sin cadena", async () => {
  assert.deepEqual(await checkVault(vault, { TILDAI_DEMO: "1" }), { status: "ok" });
  assert.equal((await checkVault(vault, { ...env, TILDAI_DEMO: "0" }, { readContract: async () => false })).status, "invalid");
});
