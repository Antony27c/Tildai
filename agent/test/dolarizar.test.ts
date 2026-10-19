import assert from "node:assert/strict";
import { test } from "node:test";

import type { Address, Hex } from "viem";

import { dolarizar } from "../src/fondos.ts";
import { pesosToWei } from "../src/money.ts";
import { opIdOf, VaultOps, type Fx } from "../src/vaultOps.ts";

const ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as Address;
const SPENDER = "0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3" as Address;
const NOW = Date.UTC(2026, 9, 20, 18, 0, 0);

type State = { used?: boolean; paused?: boolean; canSavings?: boolean; canTaxes?: boolean; maxRate?: bigint; maxSwap?: bigint; operating?: bigint; savings?: bigint; taxes?: bigint };

function setup(st: State = {}, o: { buyUsdt?: bigint; firmError?: string; ttlSeconds?: number; previewStatus?: string } = {}) {
  const state = { used: false, paused: false, canSavings: false, canTaxes: false, maxRate: pesosToWei(1700), maxSwap: pesosToWei(60_000), operating: pesosToWei(10_000), savings: pesosToWei(5_000), taxes: pesosToWei(5_000), ...st };
  const calls: string[] = [];
  const writes: any[] = [];
  const alerts: string[] = [];
  let clock = NOW;
  const reads: Record<string, any> = {
    usedOp: state.used, paused: state.paused, maxRate: state.maxRate, maxSwap: state.maxSwap, canSwapSavings: state.canSavings,
    canSwapTaxes: state.canTaxes, operating: state.operating, savings: state.savings, taxes: state.taxes,
  };
  const reader = {
    async readContract(a: any) {
      calls.push(`read:${a.functionName}`);
      return reads[a.functionName];
    },
    async simulateContract(a: any) {
      calls.push("simulate");
      return { request: { ...a } };
    },
    async waitForTransactionReceipt() {
      return { status: "success" };
    },
  };
  const wallet = {
    account: { address: "0x1" as Address },
    async writeContract(req: any) {
      calls.push("write");
      writes.push(req);
      return "0xabc" as Hex;
    },
  };
  const fx: Fx = {
    async cotizar() {
      calls.push("fx:cotizar");
      return { status: o.previewStatus ?? "preview", reason: "sin liquidez", buyAmount: o.buyUsdt ?? 600_000n };
    },
    async cotizarFirme(p) {
      calls.push("fx:cotizarFirme");
      if (o.firmError) throw new Error(o.firmError);
      assert.equal(p.maxRate, state.maxRate);
      return { spender: SPENDER, target: SPENDER, data: "0xdead", amountIn: p.monto, minOut: 590_000n, expiresAt: Math.floor(NOW / 1000) + (o.ttlSeconds ?? 60) };
    },
  };
  const ops = new VaultOps({ vault: "0x2" as Address, wallet, reader, feeCurrency: ADAPTER, now: () => clock, onRecord: () => {}, notify: (m) => alerts.push(m) });
  return { ops, fx, calls, writes, alerts, advance: (ms: number) => (clock += ms) };
}

test("caso feliz: preview, firme, simula y llama vault.swap con feeCurrency", async () => {
  const c = setup();
  const r = await c.ops.dolarizar("dolarizar:1", "operativo", pesosToWei(1000), c.fx);
  assert.equal(r.resultado, "ejecutada");
  assert.deepEqual(c.calls.filter((x) => !x.startsWith("read:")), ["fx:cotizar", "fx:cotizarFirme", "simulate", "write"]);
  assert.equal(c.calls[0], "read:usedOp"); // usedOp before asking Textile for anything
  assert.deepEqual(c.writes[0].args, [opIdOf("dolarizar:1"), 0, SPENDER, SPENDER, "0xdead", pesosToWei(1000), 590_000n]);
  assert.equal(c.writes[0].functionName, "swap");
  assert.equal(c.writes[0].feeCurrency, ADAPTER);
  assert.equal(c.alerts.length, 0);
});

test("tasa del preview sobre maxRate: no pide firme, no envía y propone subirlo (lo firma el dueño)", async () => {
  const c = setup({}, { buyUsdt: 500_000n }); // 2000 por USD₮ > 1700
  const r = await c.ops.dolarizar("d:2", "operativo", pesosToWei(1000), c.fx);
  assert.equal(r.resultado, "rechazada");
  assert.match(r.mensaje!, /\$2\.000 por USD₮.*\$1\.700/);
  assert.match(r.mensaje!, /subir.*lo firma el dueño/);
  assert.ok(!c.calls.includes("fx:cotizarFirme") && !c.calls.includes("write"));
  assert.equal(c.alerts.length, 0);
});

test("la firme supera maxRate aunque el preview no: mismo rechazo, sin tx", async () => {
  const c = setup({}, { firmError: "Cotización rechazada: tasa supera maxRate" });
  const r = await c.ops.dolarizar("d:3", "operativo", pesosToWei(1000), c.fx);
  assert.equal(r.resultado, "rechazada");
  assert.match(r.mensaje!, /lo firma el dueño/);
  assert.ok(!c.calls.includes("write"));
});

test("otro error de Textile (ej. timeout): error registrado y avisado, sin tx", async () => {
  const c = setup({}, { firmError: "Timeout al solicitar cotización firme a Textile FX" });
  const r = await c.ops.dolarizar("d:4", "operativo", pesosToWei(1000), c.fx);
  assert.equal(r.resultado, "error");
  assert.equal(c.alerts.length, 1);
  assert.ok(!c.calls.includes("write"));
});

test("cotización vencida justo antes de enviar: no manda la tx", async () => {
  const c = setup({}, { ttlSeconds: 20 });
  const sim = c.ops["cfg"].reader.simulateContract;
  c.ops["cfg"].reader.simulateContract = async (a: any) => {
    c.advance(18_000); // the simulation took long: 2 s left, under the 5 s minimum
    return sim(a);
  };
  const r = await c.ops.dolarizar("d:5", "operativo", pesosToWei(1000), c.fx);
  assert.equal(r.resultado, "rechazada");
  assert.match(r.mensaje!, /venció/);
  assert.ok(c.calls.includes("simulate") && !c.calls.includes("write"));
});

test("ahorro e impuestos sin permiso: explica que lo habilita el dueño con aviso de riesgo", async () => {
  for (const bucket of ["ahorro", "impuestos"] as const) {
    const c = setup();
    const r = await c.ops.dolarizar(`d:6:${bucket}`, bucket, pesosToWei(100), c.fx);
    assert.equal(r.resultado, "rechazada");
    assert.match(r.mensaje!, /habilita solo el dueño/);
    assert.match(r.mensaje!, /riesgo/);
    assert.ok(!c.calls.some((x) => x.startsWith("fx:") || x === "write"));
  }
});

test("con permiso habilitado el ahorro sí se dolariza usando el bucket 1", async () => {
  const c = setup({ canSavings: true });
  assert.equal((await c.ops.dolarizar("d:7", "ahorro", pesosToWei(1000), c.fx)).resultado, "ejecutada");
  assert.equal(c.writes[0].args[1], 1);
  const t = setup({ canTaxes: true });
  await t.ops.dolarizar("d:7b", "impuestos", pesosToWei(1000), t.fx);
  assert.equal(t.writes[0].args[1], 2);
});

test("opId repetido: ya ejecutada, sin cotizar ni enviar", async () => {
  const c = setup({ used: true });
  const r = await c.ops.dolarizar("d:8", "operativo", pesosToWei(1000), c.fx);
  assert.equal(r.resultado, "ya_ejecutada");
  assert.deepEqual(c.calls, ["read:usedOp"]);
});

test("vault pausado, saldo insuficiente y tope por operación: rechazo sin tx", async () => {
  for (const [st, re] of [
    [{ paused: true }, /pausado/],
    [{ operating: pesosToWei(10) }, /No alcanza/],
    [{ maxSwap: pesosToWei(10) }, /tope por operación/],
  ] as const) {
    const c = setup(st);
    const r = await c.ops.dolarizar("d:9", "operativo", pesosToWei(1000), c.fx);
    assert.equal(r.resultado, "rechazada");
    assert.match(r.mensaje!, re);
    assert.ok(!c.calls.some((x) => x.startsWith("fx:") || x === "write"));
  }
});

test("Textile sin cotización: no usa tasa por defecto", async () => {
  const c = setup({}, { previewStatus: "no_quote" });
  const r = await c.ops.dolarizar("d:10", "operativo", pesosToWei(1000), c.fx);
  assert.equal(r.resultado, "rechazada");
  assert.match(r.mensaje!, /sin liquidez/);
  assert.ok(!c.calls.includes("fx:cotizarFirme"));
});

test("función de la tool: monto en pesos, id por defecto y resultado legible", async () => {
  const c = setup();
  const r = await dolarizar(c.ops, c.fx, { bucket: "operativo", monto: 1000 }, NOW);
  assert.equal(r.monto, "$1.000");
  assert.equal(r.id, `dolarizar:2026-10-20:operativo:${pesosToWei(1000)}`);
  await assert.rejects(dolarizar(c.ops, c.fx, { bucket: "operativo", monto: -5 }, NOW));
});
