import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPublicClient, http, parseUnits, type Address, type Hex } from "viem";
import { celoSepolia } from "viem/chains";

import { ChainVault, vaultAbi } from "../src/chainVault.ts";
import { apartar, retirar } from "../src/fondos.ts";
import { pesosToWei } from "../src/money.ts";
import { SalesBook, crearCobro } from "../src/sales.ts";
import { opIdOf, VaultOps, type OpRecord } from "../src/vaultOps.ts";

const VAULT = "0x498450FE2b46F6b380857b2DE20Df7D52D17F18B" as Address;
const PAYOUT = "0x2B7c25FedB6d09e149fedc1ffE35529b1cab1f65" as Address;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 18, 0, 0);

function fakeChain(o: { used?: boolean; simulateError?: string; receipt?: string; latest?: bigint; rpcDown?: boolean; recordsFile?: string } = {}) {
  const calls: { fn: string; args?: any }[] = [];
  const records: OpRecord[] = [];
  const alerts: string[] = [];
  const reader = {
    async readContract(a: any) {
      calls.push({ fn: `read:${a.functionName}`, args: a.args });
      if (o.rpcDown) throw new Error("rpc down");
      if (a.functionName === "usedOp") return o.used ?? false;
      if (a.functionName === "payoutWallet") return PAYOUT;
      if (a.functionName === "wars") return "0x7fd80E16929Eac12833c6e214B00eFd43AD20E49";
      throw new Error(`unexpected read ${a.functionName}`);
    },
    async simulateContract(a: any) {
      calls.push({ fn: "simulate", args: a });
      if (o.simulateError) throw Object.assign(new Error("long"), { shortMessage: o.simulateError });
      return { request: { ...a, simulated: true } };
    },
    async waitForTransactionReceipt() {
      return { status: o.receipt ?? "success" };
    },
  };
  const wallet = {
    account: { address: PAYOUT },
    async writeContract(req: any) {
      calls.push({ fn: "write", args: req });
      return "0xabc" as Hex;
    },
  };
  const ops = new VaultOps({ vault: VAULT, wallet, reader, recordsFile: o.recordsFile, onRecord: (r) => records.push(r), notify: (m) => alerts.push(m) });
  return { ops, calls, records, alerts };
}
const names = (c: { calls: { fn: string }[] }) => c.calls.map((x) => x.fn);

test("apartar: simula, envía y deja registro; el opId es keccak del id de negocio", async () => {
  const c = fakeChain();
  const r = await c.ops.apartar("cierre:2026-10-20:ahorro", "ahorro", pesosToWei(2000));
  assert.equal(r.resultado, "ejecutada");
  assert.deepEqual(names(c), ["read:usedOp", "simulate", "write"]);
  const sim = c.calls[1].args;
  assert.equal(sim.functionName, "allocate");
  assert.deepEqual(sim.args, [opIdOf("cierre:2026-10-20:ahorro"), 1, pesosToWei(2000)]);
  assert.equal(c.calls[2].args.simulated, true);
  assert.equal(c.records.length, 1);
  assert.deepEqual([c.records[0].id, c.records[0].destino, c.records[0].txHash], ["cierre:2026-10-20:ahorro", "ahorro", "0xabc"]);
  assert.equal(c.alerts.length, 0);
});

test("opId repetido: devuelve 'ya ejecutada' y no simula ni envía", async () => {
  const c = fakeChain({ used: true });
  const r = await c.ops.retirar("retiro:1", pesosToWei(100));
  assert.equal(r.resultado, "ya_ejecutada");
  assert.ok(!names(c).includes("simulate") && !names(c).includes("write"));
  assert.equal(c.records[0].resultado, "ya_ejecutada");
  assert.equal(c.alerts.length, 0);
});

test("si la simulación revierte no se envía nada y se avisa", async () => {
  const c = fakeChain({ simulateError: "DailyCapExceeded" });
  const r = await c.ops.retirar("retiro:2", pesosToWei(999));
  assert.equal(r.resultado, "error");
  assert.equal(r.error, "DailyCapExceeded");
  assert.ok(!names(c).includes("write"));
  assert.equal(c.alerts.length, 1);
  assert.match(c.alerts[0], /DailyCapExceeded/);
});

test("error de RPC: queda registrado, avisa y no envía", async () => {
  const c = fakeChain({ rpcDown: true });
  const r = await c.ops.apartar("x", "impuestos", pesosToWei(10));
  assert.equal(r.resultado, "error");
  assert.deepEqual(names(c), ["read:usedOp"]);
  assert.equal(c.alerts.length, 1);
});

test("tx revertida: error con hash para poder verificar después", async () => {
  const c = fakeChain({ receipt: "reverted" });
  const r = await c.ops.retirar("retiro:3", pesosToWei(10));
  assert.equal(r.resultado, "error");
  assert.equal(r.txHash, "0xabc");
  assert.match(c.alerts[0], /0xabc/);
});

test("monto 0 no llega a la cadena", async () => {
  const c = fakeChain();
  assert.equal((await c.ops.apartar("z", "ahorro", 0n)).resultado, "error");
  assert.deepEqual(names(c), []);
});

test("cada OpRecord queda persistido en JSONL (una línea por op, con el vault) y la falla avisa por notify", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tildai-"));
  const file = join(dir, "ops.jsonl");
  const ok = fakeChain({ recordsFile: file });
  await ok.ops.apartar("a1", "ahorro", pesosToWei(10));
  const bad = fakeChain({ recordsFile: file, simulateError: "DailyCapExceeded" });
  const r = await bad.ops.retirar("r1", pesosToWei(999));
  assert.equal(r.resultado, "error");
  const lineas = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lineas.length, 2); // append: una por operación, en orden
  assert.equal(lineas[0].id, "a1");
  assert.equal(lineas[0].vault, VAULT);
  assert.equal(lineas[0].resultado, "ejecutada");
  assert.equal(lineas[0].monto, pesosToWei(10).toString()); // bigint se serializa como string
  assert.equal(lineas[1].id, "r1");
  assert.equal(lineas[1].resultado, "error");
  assert.equal(lineas[1].error, "DailyCapExceeded");
  assert.equal(bad.alerts.length, 1);
  assert.match(bad.alerts[0], /r1/);
  rmSync(dir, { recursive: true });
});

test("tools apartar/retirar: ids por defecto, montos en pesos y link de off-ramp con la wallet de retiro", async () => {
  const c = fakeChain();
  const a = await apartar(c.ops, { bucket: "ahorro", monto: 2000 }, NOW);
  assert.equal(a.monto, "$2.000");
  assert.equal(c.records[0].id, `apartar:2026-10-20:ahorro:${pesosToWei(2000)}`);
  const again = await apartar(fakeChain({ used: true }).ops, { bucket: "ahorro", monto: 2000, idOperacion: "cierre:2026-10-20:ahorro" }, NOW);
  assert.equal(again.resultado, "ya_ejecutada");

  const r = await retirar(c.ops, { monto: 50000 }, 42220, NOW);
  assert.equal(r.monto, "$50.000");
  assert.equal(r.destino, PAYOUT);
  assert.equal(r.linkOffRamp, `https://ramp.ripio.com/offramp?country=AR&chain=42220&token=WARS&amount=50000&address=${PAYOUT}`);

  const bad = await retirar(fakeChain({ simulateError: "boom" }).ops, { monto: 1 }, 42220, NOW);
  assert.equal(bad.linkOffRamp, undefined);
  await assert.rejects(retirar(c.ops, { monto: -1 }, 42220, NOW));
});

// ---- ChainVault reads
const log = (block: bigint, logIndex: number, value: bigint) => ({
  blockNumber: block, logIndex, transactionHash: `0x${block}`, args: { from: PAYOUT, to: VAULT, value },
});

function readerWith(logs: any[], o: { latest?: bigint; rpcDown?: boolean; vals?: Record<string, any> } = {}) {
  return {
    async readContract(a: any) {
      if (o.rpcDown) throw new Error("rpc down");
      return a.functionName === "wars" ? "0x7fd80E16929Eac12833c6e214B00eFd43AD20E49" : o.vals?.[a.functionName];
    },
    async getBlockNumber() {
      if (o.rpcDown) throw new Error("rpc down");
      return o.latest ?? 110n;
    },
    async getLogs(a: any) {
      return logs.filter((l) => l.blockNumber >= a.fromBlock && l.blockNumber <= a.toBlock);
    },
    async getBlock({ blockNumber }: any) {
      return { timestamp: BigInt(NOW / 1000) + blockNumber };
    },
  };
}

test("ChainVault.transfers: confirma solo con N confirmaciones y pagina por rangos", async () => {
  const v = new ChainVault({ address: VAULT, reader: readerWith([log(100n, 0, 5n), log(110n, 1, 7n)]), fromBlock: 90n, confirmations: 2, chunk: 7n });
  const t = await v.transfers();
  assert.deepEqual(t.map((x) => [x.amount, x.confirmed]), [[5n, true], [7n, false]]);
  assert.equal(t[0].id, "0x100:0");
  assert.equal(t[0].timestamp, (Math.floor(NOW / 1000) + 100) * 1000);
});

test("error de RPC: las ventas quedan pendientes, nunca cobradas", async () => {
  const v = new ChainVault({ address: VAULT, reader: readerWith([log(100n, 0, pesosToWei(500))], { rpcDown: true }), fromBlock: 90n });
  const book = new SalesBook(v, () => NOW);
  crearCobro(book, { monto: 500 }, "x");
  const orig = console.error;
  console.error = () => {};
  const r = await book.reconcile();
  console.error = orig;
  assert.equal(r.verified, false);
  assert.equal(book.sales[0].status, "pendiente");
});

test("Transfer sin confirmar no cobra; confirmado sí", async () => {
  const mk = (latest: bigint) =>
    new SalesBook(new ChainVault({ address: VAULT, reader: readerWith([log(100n, 0, pesosToWei(500))], { latest }), fromBlock: 90n, confirmations: 3 }), () => 0);
  const early = mk(101n);
  crearCobro(early, { monto: 500 }, "x");
  await early.reconcile();
  assert.equal(early.sales[0].status, "pendiente");
  const late = mk(102n);
  crearCobro(late, { monto: 500 }, "x");
  await late.reconcile();
  assert.equal(late.sales[0].status, "cobrada");
});

test("ChainVault.balances: spentToday se pone en 0 si el contador es de otro día", async () => {
  const today = BigInt(Math.floor((NOW - 3 * 3_600_000) / DAY));
  const vals = { operating: 1n, savings: 2n, taxes: 3n, spentToday: 9n, dailyCap: 10n, maxRate: 11n, paused: false };
  const same = await new ChainVault({ address: VAULT, reader: readerWith([], { vals: { ...vals, spentDay: today } }), fromBlock: 0n, now: () => NOW }).balances();
  assert.equal(same.spentToday, 9n);
  const old = await new ChainVault({ address: VAULT, reader: readerWith([], { vals: { ...vals, spentDay: today - 1n } }), fromBlock: 0n, now: () => NOW }).balances();
  assert.equal(old.spentToday, 0n);
  assert.deepEqual([old.operating, old.savings, old.taxes, old.dailyCap, old.maxRate, old.paused], [1n, 2n, 3n, 10n, 11n, false]);
});

// ---- read-only, against Celo Sepolia (TILDAI_SKIP_NETWORK=1 to skip offline)
test("Celo Sepolia: el smokeVault tiene operating = 7000 wARS", { skip: process.env.TILDAI_SKIP_NETWORK === "1" }, async () => {
  const dep = JSON.parse(readFileSync(new URL("../../contracts/deployments/celo-sepolia.json", import.meta.url), "utf8"));
  const reader = createPublicClient({ chain: celoSepolia, transport: http() });
  const v = new ChainVault({ address: dep.smokeVault, reader, fromBlock: 0n });
  const b = await v.balances();
  assert.equal(b.operating, parseUnits("7000", 18));
  assert.equal(b.savings, parseUnits("2000", 18));
  assert.equal(b.paused, false);
  assert.equal(await reader.readContract({ address: dep.smokeVault, abi: vaultAbi, functionName: "wars" }), dep.wars);
});
