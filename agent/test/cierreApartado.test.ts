import assert from "node:assert/strict";
import { test } from "node:test";

import { parseUnits, type Address, type Hex } from "viem";

import { apartadoCierre, cierreDeTodos, parsePcts } from "../src/cierreApartado.ts";
import type { Indexer } from "../src/indexerClient.ts";
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

test("cierre general: un cierre por vault a su chat; una falla no frena a los demás", async () => {
  const V1 = "0x00000000000000000000000000000000000000a1" as Address;
  const V2 = "0x00000000000000000000000000000000000000a2" as Address;
  const V3 = "0x00000000000000000000000000000000000000a3" as Address;
  // Un chain por vault: usedOp es por contrato, la idempotencia no se mezcla entre comercios.
  const chains = new Map<string, ReturnType<typeof chain>>();
  const opsDe = (address: Address) => {
    let ch = chains.get(address);
    if (!ch) chains.set(address, (ch = chain()));
    return ch.ops;
  };
  const sent: { chatId: string; texto: string }[] = [];
  const orig = console.error;
  console.error = () => {};
  try {
    await cierreDeTodos({
      jobs: [
        { chatId: "c1", vault: { address: V1, fromBlock: 0n } },
        { chatId: "c2", vault: { address: V2, fromBlock: 0n } },
        { chatId: "c3", vault: { address: V3, fromBlock: 0n } },
      ],
      datos: (v) => {
        if (v.address === V2) throw new Error("vault roto");
        return { book: bookWith(1000), balances: bal(pesosToWei(1000)) };
      },
      ops: opsDe,
      env,
      send: (chatId, texto) => sent.push({ chatId, texto }),
    });
  } finally {
    console.error = orig;
  }
  assert.equal(sent.length, 3);
  assert.equal(sent[0].chatId, "c1");
  assert.match(sent[0].texto, /Cierre de caja/);
  assert.match(sent[0].texto, /ahorro: \$100 apartados/);
  assert.equal(sent[1].chatId, "c2");
  assert.match(sent[1].texto, /cierre de caja de hoy falló.*vault roto/);
  assert.equal(sent[2].chatId, "c3");
  assert.match(sent[2].texto, /Cierre de caja/);
  assert.equal(chains.get(V1)!.writes.length, 2); // ahorro + impuestos
  assert.equal(chains.get(V2), undefined); // el vault roto nunca llegó a escribir
  assert.equal(chains.get(V3)!.writes.length, 2);
});

test("indexer caído o 503: ese cierre avisa pendiente y no aparta; los demás siguen", async () => {
  const V1 = "0x00000000000000000000000000000000000000a1" as Address;
  const V2 = "0x00000000000000000000000000000000000000a2" as Address;
  const chains = new Map<string, ReturnType<typeof chain>>();
  const opsDe = (address: Address) => {
    let ch = chains.get(address);
    if (!ch) chains.set(address, (ch = chain()));
    return ch.ops;
  };
  const indexer: Indexer = {
    eventosDesde: async () => ({ events: [], cursor: 0 }),
    pagosDelVault: async (vault) => {
      if (vault === V2.toLowerCase()) throw Object.assign(new Error("hay pagos sin timestamp todavía, reintenta"), { status: 503 });
      return [];
    },
  };
  const sent: { chatId: string; texto: string }[] = [];
  const orig = console.error;
  console.error = () => {};
  try {
    await cierreDeTodos({
      jobs: [
        { chatId: "c2", vault: { address: V2, fromBlock: 0n } }, // el del 503 primero: no frena al otro
        { chatId: "c1", vault: { address: V1, fromBlock: 0n } },
      ],
      datos: () => ({ book: bookWith(1000), balances: bal(pesosToWei(1000)) }),
      ops: opsDe,
      env,
      send: (chatId, texto) => sent.push({ chatId, texto }),
      indexer,
    });
  } finally {
    console.error = orig;
  }
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chatId, "c2");
  assert.match(sent[0].texto, /pendiente.*[Nn]o aparté nada/);
  assert.equal(chains.get(V2), undefined); // jamás llegó a las escrituras
  assert.equal(sent[1].chatId, "c1");
  assert.match(sent[1].texto, /Cierre de caja/);
  assert.equal(chains.get(V1)!.writes.length, 2);
});

test("pagos sin fecha (bloque podado): el cierre avisa que no entraron en el total y sí aparta", async () => {
  const V1 = "0x00000000000000000000000000000000000000a1" as Address;
  const c = chain();
  const W = 10n ** 18n;
  const pay = (id: string, pesos: bigint, timestamp: number | null, unavailable = false) => ({
    id,
    from: "0x9",
    amount: (pesos * W).toString(),
    txHash: "0x1",
    timestamp,
    ...(unavailable && { timestampUnavailable: true as const }),
  });
  const todos = [pay("ok", 1000n, NOW - 60_000), pay("podado", 500n, null, true)];
  // Como el server real: con rango quedan afuera los sin timestamp; sin rango vienen todos.
  const indexer: Indexer = {
    eventosDesde: async () => ({ events: [], cursor: 0 }),
    pagosDelVault: async (_v, range) => todos.filter((p) => (p.timestamp == null ? !range : !range || (p.timestamp >= range.since && p.timestamp < range.until))),
  };
  const sent: { chatId: string; texto: string }[] = [];
  const orig = console.error;
  console.error = () => {};
  try {
    await cierreDeTodos({
      jobs: [{ chatId: "c1", vault: { address: V1, fromBlock: 0n } }],
      datos: () => ({ book: bookWith(1000), balances: bal(pesosToWei(1500)) }),
      ops: () => c.ops,
      env,
      send: (chatId, texto) => sent.push({ chatId, texto }),
      indexer,
    });
  } finally {
    console.error = orig;
  }
  assert.equal(sent.length, 1);
  assert.match(sent[0].texto, /Cierre de caja/);
  assert.match(sent[0].texto, /un pago sin fecha.*no entró en el total de hoy/);
  assert.equal(c.writes.length, 2); // el día se verificó: se aparta igual, solo que se avisa lo que quedó afuera
});

test("el envío a Telegram se espera: un rechazo se observa, se avisa y los demás siguen", async () => {
  const V1 = "0x00000000000000000000000000000000000000a1" as Address;
  const V2 = "0x00000000000000000000000000000000000000a2" as Address;
  const sent: { chatId: string; texto: string }[] = [];
  const orig = console.error;
  const errores: string[] = [];
  console.error = (...a: unknown[]) => errores.push(String(a[0]));
  try {
    await cierreDeTodos({
      jobs: [
        { chatId: "c1", vault: { address: V1, fromBlock: 0n } },
        { chatId: "c2", vault: { address: V2, fromBlock: 0n } },
      ],
      datos: () => ({ book: bookWith(1000), balances: bal(pesosToWei(1000)) }),
      ops: () => chain().ops,
      env,
      // Como el send del schedule: devuelve la promesa y la espera, así el rechazo llega acá.
      send: async (chatId, texto) => {
        if (chatId === "c1" && !/falló/.test(texto)) throw new Error("telegram 500");
        sent.push({ chatId, texto });
      },
    });
  } finally {
    console.error = orig;
  }
  // Si el send no se esperara (solo waitUntil), el rechazo sería invisible y nunca saldría el aviso de fallback.
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chatId, "c1");
  assert.match(sent[0].texto, /cierre de caja de hoy falló.*telegram 500/);
  assert.equal(sent[1].chatId, "c2");
  assert.match(sent[1].texto, /Cierre de caja/);
  assert.ok(errores.some((e) => /c1.*telegram 500/.test(e)));
});

test("si también falla el aviso del fallo: se registra y sigue con el próximo vault", async () => {
  const V1 = "0x00000000000000000000000000000000000000a1" as Address;
  const V2 = "0x00000000000000000000000000000000000000a2" as Address;
  const sent: { chatId: string; texto: string }[] = [];
  const orig = console.error;
  console.error = () => {};
  try {
    await cierreDeTodos({
      jobs: [
        { chatId: "c1", vault: { address: V1, fromBlock: 0n } },
        { chatId: "c2", vault: { address: V2, fromBlock: 0n } },
      ],
      datos: () => ({ book: bookWith(1000), balances: bal(pesosToWei(1000)) }),
      ops: () => chain().ops,
      env,
      send: async (chatId, texto) => {
        if (chatId === "c1") throw new Error("telegram caído del todo");
        sent.push({ chatId, texto });
      },
    });
  } finally {
    console.error = orig;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "c2");
  assert.match(sent[0].texto, /Cierre de caja/);
});

test("si las ventas del día no se pudieron verificar, el cierre no aparta", async () => {
  const V1 = "0x00000000000000000000000000000000000000a1" as Address;
  const c = chain();
  const book = bookWith(1000);
  book.vault.transfers = async () => {
    throw new Error("indexer caído");
  };
  const sent: { chatId: string; texto: string }[] = [];
  const orig = console.error;
  console.error = () => {};
  try {
    await cierreDeTodos({
      jobs: [{ chatId: "c1", vault: { address: V1, fromBlock: 0n } }],
      datos: () => ({ book, balances: bal(pesosToWei(1000)) }),
      ops: () => c.ops,
      env,
      send: (chatId, texto) => sent.push({ chatId, texto }),
    });
  } finally {
    console.error = orig;
  }
  assert.equal(sent.length, 1);
  assert.match(sent[0].texto, /No aparté nada.*no se pudieron verificar/);
  assert.equal(c.writes.length, 0);
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
