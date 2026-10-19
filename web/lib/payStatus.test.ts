import test from "node:test";
import assert from "node:assert/strict";
import { payStatus } from "../app/cobro/status.ts";

test("payStatus: 'Cobrada' solo cuando el indexer confirmó (pollSale)", () => {
  assert.equal(payStatus({ paid: false, pending: false, settled: false, outcome: null }), null);
  const cobrada = payStatus({ paid: true, pending: false, settled: false, outcome: "cobrada" });
  assert.equal(cobrada?.title, "Cobrada");
  // txHash sin venta: la red confirmó, pero nadie la anotó todavía
  const enviado = payStatus({ paid: true, pending: false, settled: true, outcome: null });
  assert.equal(enviado?.title, "Pago enviado");
  assert.doesNotMatch(JSON.stringify(enviado), /anotad/i);
  // sin venta ni outcome jamás sale "Cobrada"
  for (const p of [
    { paid: true, pending: false, settled: true, outcome: null },
    { paid: true, pending: true, settled: false, outcome: null },
    { paid: true, pending: false, settled: false, outcome: null },
    { paid: true, pending: false, settled: false, outcome: "timeout" as const },
  ]) {
    assert.notEqual(payStatus(p)?.title, "Cobrada");
  }
});

test("payStatus: pending, timeout e info", () => {
  assert.equal(payStatus({ paid: true, pending: true, settled: false, outcome: null })?.tone, "warn");
  const t = payStatus({ paid: true, pending: false, settled: false, outcome: "timeout" });
  assert.equal(t?.tone, "warn");
  assert.equal(t?.retry, true);
  assert.equal(payStatus({ paid: true, pending: false, settled: false, outcome: "cancelled" })?.tone, "info");
});
