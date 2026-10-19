import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { pad, toEventSelector, type Address, type Hex } from "viem";

import { ChatVaultRegistry, CreadorVault, MAX_RATE, MAX_SWAP } from "../src/alta.ts";
import { factoryAbi } from "../src/chainVault.ts";
import { pesosToWei } from "../src/money.ts";
import { looksLikeSecret } from "../src/secrets.ts";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const VAULT = "0x2222222222222222222222222222222222222222" as Address;
const FACTORY = "0x3333333333333333333333333333333333333333" as Address;
const ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as Address;
const KEY = "0x" + "a".repeat(64);

function setup(o: { simulateError?: string; waitError?: string; receipt?: string; vaultOnchain?: Address; file?: string } = {}) {
  const calls: string[] = [];
  const writes: any[] = [];
  const registry = ChatVaultRegistry.load(o.file);
  const reader = {
    async readContract() {
      throw new Error("sin reads previstos");
    },
    async simulateContract(a: any) {
      calls.push("simulate");
      if (o.simulateError) throw Object.assign(new Error("x"), { shortMessage: o.simulateError });
      return { request: { ...a } };
    },
    async writeContract() {},
    async waitForTransactionReceipt({ hash }: any) {
      calls.push("wait");
      if (o.waitError) throw new Error(o.waitError);
      const logs = [{ address: FACTORY, topics: [toEventSelector("VaultCreated(address indexed vault, address indexed owner)"), pad(VAULT), pad(OWNER)], data: "0x" }];
      return { status: o.receipt ?? "success", logs, transactionHash: hash };
    },
    async getBlockNumber() {
      calls.push("getBlockNumber");
      return 100n;
    },
    async getLogs({ args }: any) {
      calls.push("getLogs");
      return o.vaultOnchain && args.owner === OWNER ? [{ args: { vault: o.vaultOnchain, owner: OWNER } }] : [];
    },
    async getTransactionReceipt() {
      calls.push("getTxReceipt");
      return null; // no minada: el reintento cae al barrido por owner
    },
    async getBlock() {
      return { timestamp: 0n };
    },
  };
  const wallet = {
    account: { address: "0x1" as Address },
    async writeContract(req: any) {
      calls.push("write");
      writes.push(req);
      return "0xfeed" as Hex;
    },
  };
  const creador = new CreadorVault({ registry, factory: FACTORY, fromBlock: 0n, reader, wallet, feeCurrency: ADAPTER, payBaseUrl: "https://pay.test" });
  return { creador, registry, calls, writes };
}

test("claves y seeds se detectan; direcciones y texto normal no", () => {
  assert.equal(looksLikeSecret(KEY), true);
  assert.equal(looksLikeSecret(KEY.slice(2)), true);
  assert.equal(looksLikeSecret("word ".repeat(12)), true);
  assert.equal(looksLikeSecret("legal winner thank year wave sausage worth useful legal winner thank yellow"), true);
  assert.equal(looksLikeSecret(OWNER), false);
  assert.equal(looksLikeSecret("mi wallet es esta, te la paso"), false);
  assert.equal(looksLikeSecret("quiero cobrar 8.500"), false);
});

test("alta feliz: vault del evento del recibo, resumen con link y límites, feeCurrency en la tx", async () => {
  const c = setup();
  const r = await c.creador.crear("42", OWNER, pesosToWei(100_000));
  assert.equal(r.estado, "creado");
  assert.equal(r.vault, VAULT);
  assert.match(r.resumen, /Tu caja está creada: 0x2222/);
  assert.match(r.resumen, /https:\/\/pay\.test\/\?vault=0x2222/);
  assert.match(r.resumen, /tope diario \$100\.000/);
  assert.match(r.resumen, /\$1\.700 por USD₮/);
  assert.deepEqual(c.calls, ["simulate", "write", "wait"]);
  assert.deepEqual(c.writes[0].args, [OWNER, OWNER, pesosToWei(100_000), MAX_RATE, MAX_SWAP]);
  assert.equal(c.writes[0].functionName, "createVault");
  assert.equal(c.writes[0].feeCurrency, ADAPTER);
});

test("dirección inválida: no se simula ni se envía", async () => {
  const c = setup();
  for (const bad of ["0x123", "mi clave", "", "0xZZZZ" + "0".repeat(36)]) {
    const r = await c.creador.crear("42", bad, pesosToWei(100_000));
    assert.equal(r.estado, "error");
    assert.match(r.mensaje, /0x.*42 caracteres/);
  }
  assert.deepEqual(c.calls, []);
});

test("/start repetido no crea dos vaults (mismo chat, entre procesos)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  const a = setup({ file });
  assert.equal((await a.creador.crear("7", OWNER, pesosToWei(50_000))).estado, "creado");
  const b = setup({ file });
  const r = await b.creador.crear("7", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "ya_existente");
  assert.equal(r.vault, VAULT);
  assert.deepEqual(b.calls, []);
  rmSync(dir, { recursive: true });
});

test("recibo revertido: error con txHash; reintentar verifica onchain y recupera el vault", async () => {
  const c = setup({ receipt: "reverted" });
  const r1 = await c.creador.crear("9", OWNER, pesosToWei(100_000));
  assert.equal(r1.estado, "error");
  assert.equal(r1.txHash, "0xfeed");
  assert.match(r1.mensaje, /no te va a quedar duplicada/);
  assert.equal(c.registry.get("9")?.vault, undefined);
  assert.equal(c.registry.get("9")?.estado, "error");

  // The tx actually landed: the retry sees it onchain and doesn't send another one.
  const c2 = setup({ file: undefined, vaultOnchain: VAULT });
  // Share the registry so the retry sees the previous txHash.
  (c.registry as any).map.forEach((v: any, k: string) => (c2.registry as any).map.set(k, v));
  const r2 = await c2.creador.crear("9", OWNER, pesosToWei(100_000));
  assert.equal(r2.estado, "ya_existente");
  assert.equal(r2.vault, VAULT);
  assert.equal(c2.calls.includes("write"), false);
  assert.equal(c2.calls.includes("getLogs"), true);
});

test("si la verificación onchain falla no crea otro vault", async () => {
  const c = setup({ receipt: "reverted" });
  await c.creador.crear("11", OWNER, pesosToWei(100_000));
  const c2 = setup();
  // Recreate the registry state but make getLogs throw.
  c2.registry["map"].set("11", c.registry.get("11")!);
  (c2.creador as any).o.reader.getLogs = async () => {
    throw new Error("rpc down");
  };
  const r = await c2.creador.crear("11", OWNER, pesosToWei(100_000));
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /no te voy a crear dos/);
  assert.equal(c2.calls.includes("write"), false);
});

test("fallo antes de enviar (simulación): error sin txHash y el chat puede reintentar", async () => {
  const c = setup({ simulateError: "out of gas" });
  const r = await c.creador.crear("12", OWNER, pesosToWei(100_000));
  assert.equal(r.estado, "error");
  assert.equal(r.txHash, undefined);
  assert.match(r.mensaje, /No se movió nada/);
  assert.equal(c.calls.includes("write"), false);
  assert.equal(c.registry.get("12")?.estado, "error");

  // Fresh attempt on the same chat goes straight to create again.
  const c2 = setup();
  assert.equal((await c2.creador.crear("12", OWNER, pesosToWei(100_000))).estado, "creado");
});

test("registry corrupto: error claro en vez de arrancar vacío", () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  const r1 = ChatVaultRegistry.load(file);
  const r2 = ChatVaultRegistry.load(undefined);
  assert.equal(r1.get("x"), undefined);
  assert.equal(r2.get("x"), undefined);
  rmSync(dir, { recursive: true });
});
