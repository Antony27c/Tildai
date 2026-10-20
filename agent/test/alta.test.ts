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
    slowSimulate?: boolean;
    writeError?: string;
    waitError?: string;
    receipt?: string;
    txReceipt?: { status: string; logs?: any[] };
    vaultOnchain?: Address;
    vaultLogBlock?: bigint;
    file?: string;
    maxAltas?: number;
    pendienteMin?: number;
    maxRate?: bigint;
    now?: () => number;
    tx?: { nonce?: number; blockNumber?: bigint | null } | null | "notfound";
    txError?: string;
    txCount?: number;
    walletAddress?: Address;
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
      if (o.slowSimulate) await new Promise((r) => setTimeout(r, 5));
      if (o.simulateError) throw Object.assign(new Error("x"), { shortMessage: o.simulateError });
      return { request: { ...a } };
    },
    async writeContract() {},
    async waitForTransactionReceipt({ hash }: any) {
      calls.push("wait");
      if (o.waitError) throw new Error(o.waitError);
      const logs = [{ address: FACTORY, topics: [toEventSelector("VaultCreated(address indexed vault, address indexed owner)"), pad(VAULT), pad(OWNER)], data: "0x", blockNumber: 777n }];
      return { status: o.receipt ?? "success", logs, transactionHash: hash, blockNumber: 777n };
    },
    async getBlockNumber() {
      calls.push("getBlockNumber");
      return 100n;
    },
    async getLogs({ args }: any) {
      calls.push("getLogs");
      return o.vaultOnchain && args.owner === OWNER ? [{ address: FACTORY, args: { vault: o.vaultOnchain, owner: OWNER }, blockNumber: o.vaultLogBlock ?? 55n }] : [];
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
    account: { address: o.walletAddress ?? ("0x1" as Address) },
    async writeContract(req: any) {
      calls.push("write");
      writes.push(req);
      if (o.writeError) throw Object.assign(new Error(o.writeError), { shortMessage: o.writeError });
      return "0xfeed" as Hex;
    },
  };
  const creador = new CreadorVault({ registry, factory: FACTORY, fromBlock: 0n, reader, wallet, feeCurrency: ADAPTER, payBaseUrl: "https://pay.test", maxAltasDia: o.maxAltas, pendienteMin: o.pendienteMin, maxRate: o.maxRate, now: o.now });
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
  assert.deepEqual(c.calls, ["simulate", "txCount", "write", "wait"]); // el nonce se fija antes de enviar
  assert.equal(c.writes[0].nonce, 0);
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
async function seedPendiente(over: { tx?: "notfound" | { nonce?: number; blockNumber?: bigint | null } | null; txCount?: number; txError?: string; vaultOnchain?: Address; vaultLogBlock?: bigint; nonce?: number; sinHash?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  const seed = ChatVaultRegistry.load(file);
  const base = { estado: "enviada" as const, owner: OWNER, dailyCap: "1", at: Date.now() - 60 * 60_000 };
  await seed.set("60", over.sinHash ? base : { ...base, txHash: "0xdead" as Hex, nonce: over.nonce });
  return { dir, file, c: setup({ file, ...over }) };
}

test("tx vieja descartada (nonce consumido aunque el nodo no la conozca): alta fallida y se puede reintentar", async () => {
  const { dir, file, c } = await seedPendiente({ tx: "notfound", nonce: 7, txCount: 8 });
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

test("tx vieja descartada pero el vault igual existe onchain: se registra con su fromBlock", async () => {
  const { dir, c } = await seedPendiente({ tx: "notfound", nonce: 7, txCount: 8, vaultOnchain: VAULT, vaultLogBlock: 55n });
  const r = await c.creador.crear("60", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "ya_existente");
  assert.equal(r.vault, VAULT);
  assert.equal(c.calls.includes("write"), false);
  assert.equal(c.registry.get("60")?.fromBlock, "55"); // nunca leer desde el bloque 0
  rmSync(dir, { recursive: true });
});

test("tx 'no encontrada' sin nonce guardado no es prueba de descarte: sigue pendiente", async () => {
  const { dir, c } = await seedPendiente({ tx: "notfound", txCount: 0 });
  const r = await c.creador.crear("60", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "pendiente"); // forno balancea nodos: un nodo puede no ver la tx con el nonce libre
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
  const c = setup();
  await c.registry.set("64", { estado: "enviada", owner: OWNER, dailyCap: "1", at: Date.now(), txHash: "0xdead" as Hex });
  const r = await c.creador.crear("64", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "pendiente");
  assert.equal(c.calls.includes("getTx"), false); // dentro del timeout ni se mira la mempool
});

test("entrada 'error' con txHash re-evalúa la tx al instante (no espera otro timeout)", async () => {
  const c = setup({ tx: { nonce: 7, blockNumber: null }, txCount: 7 });
  await c.registry.set("65", { estado: "error", owner: OWNER, dailyCap: "1", at: Date.now(), txHash: "0xdead" as Hex, nonce: 7, error: "timeout esperando el recibo" });
  const r = await c.creador.crear("65", OWNER, pesosToWei(50_000));
  assert.equal(r.estado, "pendiente"); // nonce libre: la tx puede seguir viva en mempool
  assert.equal(c.calls.includes("getTx"), true);
  assert.equal(c.calls.includes("write"), false);
});

// ---- Tests de la revisión del tester (zz-tester-alta) y de los hallazgos de auditoría ----

test("/start simultáneos de chats distintos no pasan el tope diario", async () => {
  const c = setup({ maxAltas: 2, slowSimulate: true });
  const rs = await Promise.all(["a", "b", "c", "d", "e"].map((id) => c.creador.crear(id, OWNER, pesosToWei(1000))));
  assert.ok(c.calls.filter((x) => x === "write").length <= 2, `se mandaron ${c.calls.filter((x) => x === "write").length} createVault con tope 2`);
  assert.equal(rs.filter((r) => r.estado === "creado").length, 2);
});

test("cupo devuelto si la simulación falla; conservado si writeContract pudo difundir", async () => {
  const c = setup({ maxAltas: 1, simulateError: "out of gas" });
  assert.equal((await c.creador.crear("s1", OWNER, pesosToWei(1000))).estado, "error");
  assert.equal(c.registry.altasDelDia(), 0); // nada salió: cupo libre
  const c2 = setup({ maxAltas: 1, writeError: "fetch failed (timeout)" });
  assert.equal((await c2.creador.crear("s2", OWNER, pesosToWei(1000))).estado, "error");
  assert.equal(c2.registry.altasDelDia(), 1); // la tx pudo difundirse: el cupo queda gastado
  const r3 = await c2.creador.crear("s3", OWNER, pesosToWei(1000));
  assert.match(r3.estado === "error" ? r3.mensaje : "", /máximo de comercios/);
  assert.equal(c2.calls.filter((x) => x === "write").length, 1); // solo la primera
});

test("writeContract falla tras difundir: el reintento barre la factory y registra el vault sin otra tx", async () => {
  const c = setup({ writeError: "fetch failed (timeout)" });
  const r1 = await c.creador.crear("x", OWNER, pesosToWei(1000));
  assert.equal(r1.estado, "error");
  assert.equal(c.registry.get("x")?.txHash, undefined); // nunca supimos el hash
  // La primera tx sí llegó al mempool y minó: el vault existe onchain.
  const c2 = setup({ vaultOnchain: VAULT, vaultLogBlock: 55n });
  (c.registry as any).map.forEach((v: any, k: string) => (c2.registry as any).map.set(k, v));
  const r2 = await c2.creador.crear("x", OWNER, pesosToWei(1000));
  assert.equal(r2.estado, "ya_existente");
  assert.equal(r2.vault, VAULT);
  assert.equal(c2.calls.includes("write"), false);
  assert.equal(c2.registry.get("x")?.fromBlock, "55");
});

test("intento previo sin hash (crash entre write y registry.set): barre antes de enviar", async () => {
  const c = setup({ vaultOnchain: VAULT, vaultLogBlock: 41n });
  await c.registry.set("crash", { estado: "enviada", owner: OWNER, dailyCap: "1", at: Date.now() - 1000 }); // sin txHash
  const r = await c.creador.crear("crash", OWNER, pesosToWei(1000));
  assert.equal(r.estado, "ya_existente");
  assert.equal(c.calls.includes("write"), false);
  assert.equal(c.registry.get("crash")?.fromBlock, "41");
});

test("intento previo sin hash y barrido que falla: error sin tx", async () => {
  const c = setup();
  await c.registry.set("crash2", { estado: "error", owner: OWNER, dailyCap: "1", at: Date.now() - 1000 });
  (c.creador as any).o.reader.getLogs = async () => {
    throw new Error("rpc down");
  };
  const r = await c.creador.crear("crash2", OWNER, pesosToWei(1000));
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /no te voy a crear dos/);
  assert.equal(c.calls.includes("write"), false);
});

test("el alta rechaza owner = wallet del agente", async () => {
  const c = setup({ walletAddress: OWNER });
  const r = await c.creador.crear("self", OWNER, pesosToWei(1000));
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /mi wallet.*MiniPay|firme/i);
  assert.deepEqual(c.calls, []); // ni simuló
});

test("el nonce de la tx enviada queda guardado en el registro (se fija antes de enviar)", async () => {
  const c = setup({ txCount: 7, waitError: "timeout" });
  await c.creador.crear("n", OWNER, pesosToWei(1000));
  assert.equal(c.writes[0].nonce, 7); // createVault salió con el nonce reservado
  assert.equal(c.registry.get("n")?.nonce, 7);
  assert.equal(c.registry.get("n")?.estado, "error"); // wait falló, pero nonce + txHash quedaron
  assert.equal(c.registry.get("n")?.txHash, "0xfeed");
});

// La primera tx quedó en el mempool cuando un /start rápido reintenta: el reenvío sale con el MISMO
// nonce (reemplaza a la vieja o es ella), jamás con otro — eso es lo que impide que minen dos vaults.
test("writeContract falla tras difundir: el reintento rápido reenvía con el MISMO nonce, una sola createVault efectiva", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  const c = setup({ file, writeError: "fetch failed (timeout)", txCount: 0 });
  const r1 = await c.creador.crear("x", OWNER, pesosToWei(1000));
  assert.equal(r1.estado, "error");
  assert.equal(c.registry.get("x")?.txHash, undefined); // nunca supimos el hash
  assert.equal(c.registry.get("x")?.nonce, 0); // pero el nonce quedó fijado y persistido
  assert.equal(c.writes[0].nonce, 0);
  // Reintento rápido, la primera sigue en mempool (latest = 0 → nonce 0 libre). Otro proceso leyendo el archivo.
  const c2 = setup({ file, txCount: 0 });
  const r2 = await c2.creador.crear("x", OWNER, pesosToWei(1000));
  assert.equal(r2.estado, "creado");
  assert.equal(c2.writes.length, 1);
  assert.equal(c2.writes[0].nonce, 0, "el reintento salió con otro nonce: las dos tx pueden minar → dos vaults");
  assert.equal(c2.registry.altasDelDia(), 1); // es la misma alta: no gasta otro cupo del tope
  rmSync(dir, { recursive: true });
});

test("nonce fijado ya consumido: barre la factory; con vault lo registra, sin vault la alta queda fallida reintentable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  const c = setup({ file, writeError: "fetch failed (timeout)", txCount: 0 });
  await c.creador.crear("y", OWNER, pesosToWei(1000)); // nonce 0 fijado, sin hash

  // Caso 1: el nonce ya se consumió y en la cadena está el VaultCreated.
  const c2 = setup({ file, txCount: 1, vaultOnchain: VAULT, vaultLogBlock: 55n });
  const r2 = await c2.creador.crear("y", OWNER, pesosToWei(1000));
  assert.equal(r2.estado, "ya_existente");
  assert.equal(r2.vault, VAULT);
  assert.equal(c2.calls.includes("write"), false);
  assert.equal(c2.registry.get("y")?.fromBlock, "55");

  // Caso 2: el nonce se consumió pero no hay VaultCreated (la tx no creó nada). La entrada queda
  // SIN nonce → el próximo reintento fija uno nuevo.
  const dir2 = mkdtempSync(join(tmpdir(), "tildai-"));
  const file2 = join(dir2, "chats.json");
  const d = setup({ file: file2, writeError: "fetch failed (timeout)", txCount: 0 });
  await d.creador.crear("z", OWNER, pesosToWei(1000));
  const d2 = setup({ file: file2, txCount: 1 }); // nonce 0 consumido, sin vault
  const r3 = await d2.creador.crear("z", OWNER, pesosToWei(1000));
  assert.equal(r3.estado, "error");
  assert.match(r3.mensaje, /confirmó sin crear el vault.*Probá \/start de nuevo/);
  assert.equal(d2.calls.includes("write"), false);
  assert.equal(d2.registry.get("z")?.nonce, undefined);
  const d3 = setup({ file: file2, txCount: 5 });
  const r4 = await d3.creador.crear("z", OWNER, pesosToWei(1000));
  assert.equal(r4.estado, "creado");
  assert.equal(d3.writes[0].nonce, 5); // intento nuevo → nonce nuevo
  rmSync(dir, { recursive: true });
  rmSync(dir2, { recursive: true });
});

test("el nonce fijado se escribe en el archivo ANTES de difundir (crash durante writeContract)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "chats.json");
  const c = setup({ file, writeError: "timeout", txCount: 3 });
  await c.creador.crear("w", OWNER, pesosToWei(1000));
  const desdeArchivo = ChatVaultRegistry.load(file).get("w");
  assert.equal(desdeArchivo?.nonce, 3);
  rmSync(dir, { recursive: true });
});

const SELECTOR_VAULT_CREATED = toEventSelector("VaultCreated(address indexed vault, address indexed owner)");
const OTRO_OWNER = "0x9999999999999999999999999999999999999999" as Address;

// Repro del hallazgo G: sin un lock global, dos /start de chats distintos leen el mismo pending y
// envían con el mismo nonce — si el gas del segundo supera al primero, lo reemplaza y el chat A
// podía quedar con el vault de B. El lock serializa "fijar nonce → persistir → difundir".
test("dos altas en paralelo de chats distintos fijan nonces distintos", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  // registry.set con archivo real: la persistencia da el hueco donde, sin lock, el segundo /start
  // leería el mismo pending que el primero.
  const c = setup({ file: join(dir, "chats.json"), slowSimulate: true });
  const reader = (c.creador as any).o.reader;
  const wallet = (c.creador as any).o.wallet;
  // El pending del nodo incluye las tx ya difundidas (modela el nodo real).
  reader.getTransactionCount = async () => 7 + c.writes.length;
  // Hash distinto por envío y el VaultCreated del recibo con el owner de ESA tx.
  const ownerDeHash = new Map<string, Address>();
  wallet.writeContract = async (req: any) => {
    c.calls.push("write");
    c.writes.push(req);
    const h = `0xhash${c.writes.length}` as Hex;
    ownerDeHash.set(h, req.args[0]);
    return h;
  };
  reader.waitForTransactionReceipt = async ({ hash }: any) => ({
    status: "success",
    logs: [{ address: FACTORY, topics: [SELECTOR_VAULT_CREATED, pad(VAULT), pad(ownerDeHash.get(hash)!)], data: "0x", blockNumber: 777n }],
    transactionHash: hash,
    blockNumber: 777n,
  });
  const [ra, rb] = await Promise.all([
    c.creador.crear("A", OWNER, pesosToWei(1000)),
    c.creador.crear("B", OTRO_OWNER, pesosToWei(1000)),
  ]);
  assert.equal(ra.estado, "creado");
  assert.equal(rb.estado, "creado");
  assert.equal(c.writes.length, 2);
  assert.notEqual(c.writes[0].nonce, c.writes[1].nonce, "dos altas en paralelo fijaron el mismo nonce");
  assert.deepEqual(c.writes.map((w) => w.nonce).sort(), [7, 8]);
  rmSync(dir, { recursive: true });
});

// Si viem sigue el reemplazo y el recibo trae un VaultCreated que no es nuestro, la entrada no se da
// por buena: conserva hash+nonce y el reintento verifica onchain / barre por owner.
test("recibo con VaultCreated de otro owner o de otra factory: el alta no se asigna", async () => {
  const reciboAjeno = (address: Address, owner: Address) => async ({ hash }: any) => ({
    status: "success",
    logs: [{ address, topics: [SELECTOR_VAULT_CREATED, pad(VAULT), pad(owner)], data: "0x", blockNumber: 777n }],
    transactionHash: hash,
    blockNumber: 777n,
  });
  const c = setup();
  (c.creador as any).o.reader.waitForTransactionReceipt = reciboAjeno(FACTORY, OTRO_OWNER);
  const r = await c.creador.crear("x", OWNER, pesosToWei(1000));
  assert.equal(r.estado, "error");
  assert.equal(c.registry.get("x")?.vault, undefined);
  assert.equal(c.registry.get("x")?.txHash, "0xfeed");
  assert.equal(c.registry.get("x")?.nonce, 0); // conserva el nonce fijado para la recuperación

  const c2 = setup();
  (c2.creador as any).o.reader.waitForTransactionReceipt = reciboAjeno("0x8888888888888888888888888888888888888888" as Address, OWNER);
  const r2 = await c2.creador.crear("x", OWNER, pesosToWei(1000));
  assert.equal(r2.estado, "error");
  assert.equal(c2.registry.get("x")?.vault, undefined);
});

test("el barrido ignora un VaultCreated emitido por otra dirección", async () => {
  const c = setup({ vaultOnchain: VAULT, vaultLogBlock: 55n });
  (c.creador as any).o.reader.getLogs = async () => [
    { address: "0x8888888888888888888888888888888888888888", args: { vault: VAULT, owner: OWNER }, blockNumber: 55n },
  ];
  await c.registry.set("s", { estado: "enviada", owner: OWNER, dailyCap: "1", at: Date.now() - 1000 });
  const r = await c.creador.crear("s", OWNER, pesosToWei(1000));
  // No encontró vault de NUESTRA factory para ese owner → el alta sigue su curso normal.
  assert.equal(r.estado, "creado");
  assert.equal(c.calls.includes("write"), true);
});

test("createVault usa el maxRate configurado y el resumen lo muestra", async () => {
  const c = setup({ maxRate: pesosToWei(2100) });
  const r = await c.creador.crear("m", OWNER, pesosToWei(1000));
  assert.equal(r.estado, "creado");
  assert.deepEqual(c.writes[0].args, [OWNER, OWNER, pesosToWei(1000), pesosToWei(2100), MAX_SWAP]);
  assert.match((r as { resumen: string }).resumen, /\$2\.100 por USD₮/);
});
