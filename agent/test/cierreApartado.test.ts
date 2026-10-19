import assert from "node:assert/strict";
import { test } from "node:test";

import { parseUnits, type Address, type Hex } from "viem";

import { apartadoCierre, parsePcts } from "../src/cierreApartado.ts";
import { pesosToWei } from "../src/money.ts";
import { SalesBook } from "../src/sales.ts";
import { FakeVault } from "../src/vault.ts";
import { opIdOf, VaultOps } from "../src/vaultOps.ts";

const NOW = Date.UTC(2026, 9, 20, 23, 55, 0); // 20:55 ART del 20/10
const ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as Address;

// Stateful fake chain: a written opId becomes used, like the real vault.
function chain(o: { simulateError?: string; feeCurrency?: Address } = {}) {
  const used = new Set<Hex>();
  const writes: any[] = [];
  const alerts: string[] = [];
  const reader = {
    async readContract(a: any) {
      return a.functionName === "usedOp" ? used.has(a.args[0]) : "0xPAYOUT";
    },
    async simulateContract(a: any) {
      if (o.simulateError) throw Object.assign(new Error("x"), { shortMessage: o.simulateError });
      return { request: { ...a } };
    },
    async waitForTransactionReceipt() {
      return { status: "success" };
    },
  };
  const wallet = {
    account: { address: "0x1" as Address },
    async writeContract(req: any) {
      writes.push(req);
      used.add(req.args[0]);
      return "0xabc" as Hex;
    },
  };
  const ops = new VaultOps({ vault: "0x2" as Address, wallet, reader, feeCurrency: o.feeCurrency, onRecord: () => {}, notify: (m) => alerts.push(m) });
  return { ops, writes, alerts };
}

function bookWith(...pesos: number[]) {
  const vault = new FakeVault();
  pesos.forEach((p) => vault.deposit(pesosToWei(p), { timestamp: NOW - 60_000 }));
  return new SalesBook(vault, () => NOW);
}
const env = { savings: "10", taxes: "21" };
const bal = (operating: bigint, paused = false) => async () => ({ operating, paused });

async function run(book: SalesBook, c: ReturnType<typeof chain>, operating: bigint, e = env, paused = false) {
  await book.reconcile();
  return apartadoCierre({ book, ops: c.ops, balances: bal(operating, paused), env: e });
}

test("porcentajes inválidos o faltantes: no aparta y lo dice", async () => {
  for (const e of [{}, { savings: "10" }, { savings: "", taxes: "5" }, { savings: "-1", taxes: "5" }, { savings: "101", taxes: "0" }, { savings: "abc", taxes: "5" }, { savings: "60", taxes: "40.01" }, { savings: "1.234", taxes: "1" }]) {
    assert.equal(parsePcts(e).ok, false, JSON.stringify(e));
    const c = chain();
    const r = await run(bookWith(1000), c, pesosToWei(1000), e);
    assert.match(r.texto, /^No aparté nada/);
    assert.equal(c.writes.length, 0);
  }
  assert.equal(parsePcts({ savings: "60", taxes: "40" }).ok, true);
  assert.equal(parsePcts({ savings: "0", taxes: "0" }).ok, true);
});

test("aparta ahorro e impuestos con ids 'cierre:<fecha AR>:...' y montos hacia abajo", async () => {
  const c = chain();
  const r = await run(bookWith(1000, 2000.01), c, pesosToWei(5000));
  assert.deepEqual(c.writes.map((w) => w.args), [
    [opIdOf("cierre:2026-10-20:ahorro"), 1, 300_001_000_000_000_000_000n], // 10% de 3000.01, sin redondeo hacia arriba
    [opIdOf("cierre:2026-10-20:impuestos"), 2, 630_002_100_000_000_000_000n],
  ]);
  assert.deepEqual(r.records.map((x) => x.resultado), ["ejecutada", "ejecutada"]);
  assert.match(r.texto, /ahorro: \$300 apartados/);
});

test("floor en wei: 33,33% de un monto no redondea hacia arriba", async () => {
  const c = chain();
  await run(bookWith(0.01), c, pesosToWei(1), { savings: "33.33", taxes: "0" });
  assert.equal(c.writes[0].args[2], (pesosToWei(0.01) * 3333n) / 10_000n);
  assert.equal(c.writes.length, 1); // impuestos 0%: nada que apartar
});

test("cierre repetido no aparta dos veces", async () => {
  const c = chain();
  const book = bookWith(1000);
  await run(book, c, pesosToWei(1000));
  const again = await run(book, c, pesosToWei(1000));
  assert.equal(c.writes.length, 2);
  assert.deepEqual(again.records.map((x) => x.resultado), ["ya_ejecutada", "ya_ejecutada"]);
  assert.match(again.texto, /ya estaban apartados/);
});

test("base mayor a operating se recorta", async () => {
  const c = chain();
  const r = await run(bookWith(1000), c, pesosToWei(500));
  assert.equal(c.writes[0].args[2], pesosToWei(50)); // 10% de 500
  assert.equal(c.writes[1].args[2], pesosToWei(105));
  assert.match(r.texto, /recortada/);
});

test("sin ventas confirmadas no aparta", async () => {
  const c = chain();
  const r = await run(bookWith(), c, pesosToWei(1000));
  assert.equal(c.writes.length, 0);
  assert.match(r.texto, /no hubo ventas/);
});

test("vault pausado: no escribe ni reintenta", async () => {
  const c = chain();
  const orig = console.error;
  console.error = () => {};
  const r = await run(bookWith(1000), c, pesosToWei(1000), env, true);
  console.error = orig;
  assert.equal(c.writes.length, 0);
  assert.match(r.texto, /pausado/);
});

test("error de lectura del vault: no aparta y avisa", async () => {
  const book = bookWith(1000);
  await book.reconcile();
  const orig = console.error;
  console.error = () => {};
  const r = await apartadoCierre({ book, ops: chain().ops, balances: async () => { throw new Error("rpc down"); }, env });
  console.error = orig;
  assert.match(r.texto, /No aparté nada.*rpc down/);
});

test("error de escritura: avisa, registra, corta y no reintenta", async () => {
  const c = chain({ simulateError: "IsPaused" });
  const r = await run(bookWith(1000), c, pesosToWei(1000));
  assert.equal(r.records.length, 1); // no intenta impuestos después del error
  assert.equal(r.records[0].resultado, "error");
  assert.equal(c.alerts.length, 1);
  assert.match(r.texto, /NO se pudo apartar \(IsPaused\)/);
  assert.match(r.texto, /Corté acá/);
});

test("mainnet: la escritura lleva feeCurrency (adapter de USD₮); sin feeCurrency en Sepolia", async () => {
  const main = chain({ feeCurrency: ADAPTER });
  await main.ops.apartar("a", "ahorro", parseUnits("1", 18));
  assert.equal(main.writes[0].feeCurrency, ADAPTER);
  assert.equal(main.writes[0].functionName, "allocate"); // the simulated request is preserved
  const sep = chain();
  await sep.ops.apartar("a", "ahorro", parseUnits("1", 18));
  assert.equal("feeCurrency" in sep.writes[0], false);
});
