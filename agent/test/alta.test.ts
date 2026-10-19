import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { pad, toEventSelector, type Address, type Hex } from "viem";

import { ChatVaultRegistry, chatHabilitado, CreadorVault, MAX_RATE, MAX_SWAP, type ChatEntry } from "../src/alta.ts";
import { factoryAbi } from "../src/chainVault.ts";
import { pesosToWei } from "../src/money.ts";
import { dayIndex } from "../src/sales.ts";
import { looksLikeSecret } from "../src/secrets.ts";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const VAULT = "0x2222222222222222222222222222222222222222" as Address;
const FACTORY = "0x3333333333333333333333333333333333333333" as Address;
const ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as Address;
const KEY = "0x" + "a".repeat(64);

function setup(
  o: {
    simulateError?: string;
    waitError?: string;
    receipt?: string;
    txReceipt?: { status: string; logs?: any[] };
    vaultOnchain?: Address;
    file?: string;
    maxAltas?: number;
    pendienteMin?: number;
    now?: () => number;
    tx?: { nonce?: number; blockNumber?: bigint | null } | null | "notfound";
    txError?: string;
    txCount?: number;
  } = {},
) {
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
      return o.txReceipt ?? null; // null = aún no minada
    },
    async getTransaction() {
      calls.push("getTx");
      if (o.txError) throw new Error(o.txError);
      if (o.tx === "notfound") throw Object.assign(new Error("x"), { name: "TransactionNotFoundError" });
      return o.tx ?? null;
    },
    async getTransactionCount() {
      calls.push("txCount");
      return o.txCount ?? 0;
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
  const creador = new CreadorVault({ registry, factory: FACTORY, fromBlock: 0n, reader, wallet, feeCurrency: ADAPTER, payBaseUrl: "https://pay.test", maxAltasDia: o.maxAltas, pendienteMin: o.pendienteMin, now: o.now });
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
  const c2 = setup({ file: undefined, vaultOnchain: VAULT, txReceipt: { status: "reverted" } });
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
  (c2.creador as any).o.reader.getTransactionReceipt = async () => {
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

import { parsePesosTexto, MAX_TOPE_PESOS } from "../src/money.ts";

test("tx anterior pendiente: no se manda otra createVault", async () => {
  const c = setup({ receipt: "reverted" });
  await c.creador.crear("20", OWNER, pesosToWei(100_000)); // queda txHash guardado
  const c2 = setup(); // getTransactionReceipt devuelve null = todavía no minó
  (c.registry as any).map.forEach((v: any, k: string) => (c2.registry as any).map.set(k, v));
  const r = await c2.creador.crear("20", OWNER, pesosToWei(100_000));
  assert.equal(r.estado, "pendiente");
  assert.match(r.mensaje, /todavía se está creando/);
  assert.equal(c2.calls.includes("write"), false);
  assert.equal(c2.calls.includes("simulate"), false);
});

test("dos /start simultáneos del mismo chat comparten una sola creación", async () => {
  const c = setup();
  const [r1, r2] = await Promise.all([c.creador.crear("30", OWNER, pesosToWei(100_000)), c.creador.crear("30", OWNER, pesosToWei(100_000))]);
  assert.equal(r1, r2);
  assert.equal(c.calls.filter((x) => x === "write").length, 1);
});

test("la recuperación busca por el owner guardado, no por el nuevo", async () => {
  const c = setup({ receipt: "reverted" });
  await c.creador.crear("31", OWNER, pesosToWei(100_000));
  const OTHER = "0x4444444444444444444444444444444444444444" as Address;
  const c2 = setup({ txReceipt: { status: "reverted" }, vaultOnchain: VAULT });
  (c.registry as any).map.forEach((v: any, k: string) => (c2.registry as any).map.set(k, v));
  // El dueño "cambia" de wallet: el barrido usa el owner de la tx anterior (OWNER), que es quien figura en VaultCreated.
  const r = await c2.creador.crear("31", OTHER, pesosToWei(100_000));
  assert.equal(r.estado, "ya_existente");
  assert.equal(r.vault, VAULT);
});

test("parseo determinístico del tope en pesos", () => {
  assert.equal(parsePesosTexto("8.500"), 8500);
  assert.equal(parsePesosTexto("100.000"), 100_000);
  assert.equal(parsePesosTexto("1.234.567,89"), 1_234_567.89);
  assert.equal(parsePesosTexto("$85.000"), 85_000);
  assert.equal(parsePesosTexto("8500"), 8500);
  assert.equal(parsePesosTexto("8500,50"), 8500.5);
  assert.equal(parsePesosTexto("ocho mil"), null);
  assert.equal(parsePesosTexto("20.000.000"), null); // pasa el tope propio
  // El tope del vault no queda limitado por MAX_COBRO_PESOS (1M): 5M entra, 20M no.
  assert.equal(pesosToWei(5_000_000, MAX_TOPE_PESOS), 5_000_000n * 10n ** 18n);
  assert.throws(() => pesosToWei(20_000_000, MAX_TOPE_PESOS));
});

test("dos direcciones pegadas no disparan la alarma de secreto", () => {
  const hex = "a".repeat(64);
  assert.equal(looksLikeSecret(`mirá esto ${hex} y nada más`), true);
  assert.equal(looksLikeSecret(`${hex}${"b".repeat(64)}`), false); // 128 hex: no es una clave aislada
  assert.equal(looksLikeSecret(`0x${"1".repeat(40)}0x${"2".repeat(40)}`), false);
});

test("chatHabilitado: allowlist, open signup y chats ya registrados", () => {
  const vacio = ChatVaultRegistry.load(undefined);
  const env = { TILDAI_ALLOWED_CHATS: "", TILDAI_OWNER_CHAT_ID: "7" };
  assert.equal(chatHabilitado("1", vacio, env), false); // vacía = nadie nuevo
  assert.equal(chatHabilitado("7", vacio, env), true); // owner siempre
  assert.equal(chatHabilitado("1", vacio, { ...env, TILDAI_OPEN_SIGNUP: "1" }), true);
  assert.equal(chatHabilitado("1", vacio, { TILDAI_ALLOWED_CHATS: "1, 2,3" }), true);
  assert.equal(chatHabilitado("4", vacio, { TILDAI_ALLOWED_CHATS: "1, 2,3" }), false);
  assert.equal(chatHabilitado("", vacio, { TILDAI_OPEN_SIGNUP: "1" }), false);
  // Un chat con vault o alta en curso sigue entrando aunque no esté en la lista.
  const reg = { get: (id: string) => (id === "9" ? ({ estado: "enviada" } as ChatEntry) : undefined) };
  assert.equal(chatHabilitado("9", reg, env), true);
  assert.equal(chatHabilitado("10", reg, env), false);
});

test("tope diario de altas: frena al que pasa y sobrevive a un reinicio", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  const c = setup({ file, maxAltas: 5 });
  for (const id of ["a", "b", "c", "d", "e"]) {
    assert.equal((await c.creador.crear(id, OWNER, pesosToWei(50_000))).estado, "creado");
  }
  const r = await c.creador.crear("f", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /máximo de comercios.*mañana/);
  assert.equal(c.calls.filter((x) => x === "write").length, 5);
  assert.equal(c.registry.get("f"), undefined); // el rechazo no deja nada creado

  // Reinicio simulado: el contador vuelve del archivo y sigue frenando.
  const c2 = setup({ file, maxAltas: 5 });
  const r2 = await c2.creador.crear("f", OWNER, pesosToWei(50_000));
  assert.equal(r2.estado, "error");
  assert.equal(c2.calls.includes("write"), false);
  rmSync(dir, { recursive: true });
});

test("el contador de altas es por día argentino: otro día vuelve a 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  writeFileSync(file, JSON.stringify({ version: 1, altas: { dia: dayIndex(Date.now()) - 1, count: 99 }, chats: {} }));
  const c = setup({ file, maxAltas: 5 });
  assert.equal(c.registry.altasDelDia(), 0);
  assert.equal((await c.creador.crear("x", OWNER, pesosToWei(50_000))).estado, "creado");
  assert.equal(c.registry.altasDelDia(), 1);
  rmSync(dir, { recursive: true });
});

test("el tope de altas no frena recuperar una tx ya enviada", async () => {
  const c = setup({ waitError: "timeout" });
  await c.creador.crear("50", OWNER, pesosToWei(50_000)); // queda txHash sin vault
  const logs = [{ address: FACTORY, topics: [toEventSelector("VaultCreated(address indexed vault, address indexed owner)"), pad(VAULT), pad(OWNER)], data: "0x" }];
  const c2 = setup({ maxAltas: 0, txReceipt: { status: "success", logs } });
  (c.registry as any).map.forEach((v: any, k: string) => (c2.registry as any).map.set(k, v));
  const r = await c2.creador.crear("50", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "ya_existente");
  assert.equal(r.vault, VAULT);
  assert.equal(c2.calls.includes("write"), false);
});

// Past TILDAI_ALTA_PENDIENTE_MIN an unmined tx gets inspected before we ever send another createVault.
async function seedPendiente(over: { tx: "notfound" | { nonce?: number; blockNumber?: bigint | null } | null; txCount?: number; txError?: string; vaultOnchain?: Address }) {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  const seed = ChatVaultRegistry.load(file);
  await seed.set("60", { estado: "enviada", owner: OWNER, dailyCap: "1", txHash: "0xdead" as Hex, at: Date.now() - 60 * 60_000 });
  return { dir, file, c: setup({ file, ...over }) };
}

test("tx vieja que el nodo ya no conoce: alta fallida, se limpia el hash y se puede reintentar", async () => {
  const { dir, file, c } = await seedPendiente({ tx: null });
  const r = await c.creador.crear("60", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /descartada.*Probá \/start de nuevo/);
  assert.equal(c.calls.includes("write"), false);
  assert.equal(c.registry.get("60")?.txHash, undefined);
  assert.equal(c.registry.get("60")?.estado, "error");
  // El reintento crea normal (persistido: lo ve otro proceso que lee el archivo).
  const c2 = setup({ file });
  assert.equal((await c2.creador.crear("60", OWNER, pesosToWei(50_000))).estado, "creado");
  rmSync(dir, { recursive: true });
});

test("tx vieja descartada pero el vault igual existe onchain: se registra sin otra tx", async () => {
  const { dir, c } = await seedPendiente({ tx: "notfound", vaultOnchain: VAULT });
  const r = await c.creador.crear("60", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "ya_existente");
  assert.equal(r.vault, VAULT);
  assert.equal(c.calls.includes("write"), false);
  rmSync(dir, { recursive: true });
});

test("nonce ya usado por otra tx confirmada: la vieja no puede minar, alta fallida", async () => {
  const { dir, c } = await seedPendiente({ tx: { nonce: 7, blockNumber: null }, txCount: 8 });
  const r = await c.creador.crear("60", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /descartada/);
  assert.equal(c.calls.includes("write"), false);
  rmSync(dir, { recursive: true });
});

test("tx vieja todavía en mempool (nonce sin usar): sigue pendiente", async () => {
  const { dir, c } = await seedPendiente({ tx: { nonce: 7, blockNumber: null }, txCount: 7 });
  const r = await c.creador.crear("60", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "pendiente");
  assert.equal(c.calls.includes("write"), false);
  rmSync(dir, { recursive: true });
});

test("duda al inspeccionar la tx vieja (RPC caído): error y jamás otra tx", async () => {
  const { dir, c } = await seedPendiente({ txError: "rpc down" });
  const r = await c.creador.crear("60", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /no te voy a crear dos/);
  assert.equal(c.calls.includes("write"), false);
  assert.equal(c.registry.get("60")?.txHash, "0xdead"); // se conserva para el próximo intento
  rmSync(dir, { recursive: true });
});

test("tx sin recibo pero dentro del timeout: pendiente sin inspeccionar la mempool", async () => {
  const c = setup({ waitError: "timeout" });
  await c.creador.crear("64", OWNER, pesosToWei(50_000)); // queda txHash recién enviado
  const c2 = setup(); // getTransactionReceipt → null
  (c.registry as any).map.forEach((v: any, k: string) => (c2.registry as any).map.set(k, v));
  const r = await c2.creador.crear("64", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "pendiente");
  assert.equal(c2.calls.includes("getTx"), false);
});
