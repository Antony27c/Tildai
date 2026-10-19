import assert from "node:assert/strict";
import { test } from "node:test";

import { pesosToWei } from "../src/money.ts";
import { avisoPago, cierreCaja, crearCobro, SalesBook, ventasHoy } from "../src/sales.ts";
import { FakeVault, type Transfer } from "../src/vault.ts";

const DAY = 86_400_000;
// Tue 2026-10-20 15:00 ART
const NOW = Date.UTC(2026, 9, 20, 18, 0, 0);
const setup = () => {
  const vault = new FakeVault();
  return { vault, book: new SalesBook(vault, () => NOW) };
};

test("crear_cobro: link, monto y estado pendiente", () => {
  const { book, vault } = setup();
  const r = crearCobro(book, { monto: 8500 }, "https://pay.test/");
  assert.equal(r.ventaId, 1);
  assert.equal(r.monto, "$8.500");
  assert.equal(r.estado, "pendiente");
  assert.equal(r.link, "https://pay.test/pagar/1?amount=8500");
  assert.ok(r.rampLink.includes(`address=${vault.address}`));
});

test("crear_cobro: rechaza montos fuera de las reglas", () => {
  const { book } = setup();
  for (const monto of [0, -5, NaN, 1_000_001, 10.001]) assert.throws(() => crearCobro(book, { monto }, "x"), `monto ${monto}`);
  assert.equal(book.sales.length, 0);
});

test("ventas_hoy: cobrada solo con Transfer confirmada", async () => {
  const { book, vault } = setup();
  crearCobro(book, { monto: 1000 }, "x");
  crearCobro(book, { monto: 500 }, "x");
  const t = vault.deposit(pesosToWei(1000), { timestamp: NOW, confirmed: false });
  let r = await ventasHoy(book);
  assert.equal(r.cantidad, 0);
  assert.equal(r.pendientes.length, 2);
  vault.confirm(t.id);
  r = await ventasHoy(book);
  assert.deepEqual([r.cantidad, r.total, r.ticketPromedio], [1, "$1.000", "$1.000"]);
  assert.deepEqual(r.pendientes, [{ ventaId: 2, monto: "$500" }]);
});

test("ventas_hoy: si falla el vault queda pendiente y avisa", async () => {
  const { book, vault } = setup();
  crearCobro(book, { monto: 1000 }, "x");
  vault.transfers = async () => {
    throw new Error("rpc down");
  };
  const orig = console.error;
  console.error = () => {};
  const r = await ventasHoy(book);
  console.error = orig;
  assert.equal(r.verificado, false);
  assert.ok(r.aviso);
  assert.equal(r.cantidad, 0);
  assert.equal(book.sales[0].status, "pendiente");
});

test("aviso_pago: avisa una sola vez y suma ventas de QR fijo", async () => {
  const { book, vault } = setup();
  crearCobro(book, { monto: 8500 }, "x");
  vault.deposit(pesosToWei(8500), { timestamp: NOW });
  vault.deposit(pesosToWei(300), { timestamp: NOW });
  const a = await avisoPago(book);
  assert.deepEqual(a.avisos, ["✓ Entraron $8.500 (venta #1)", "✓ Entraron $300 (venta #2)"]);
  assert.deepEqual((await avisoPago(book)).avisos, []);
});

test("el mismo Transfer no concilia dos ventas", async () => {
  const { book, vault } = setup();
  crearCobro(book, { monto: 100 }, "x");
  crearCobro(book, { monto: 100 }, "x");
  vault.deposit(pesosToWei(100), { timestamp: NOW });
  await book.reconcile();
  await book.reconcile();
  assert.deepEqual(book.sales.map((s) => s.status), ["cobrada", "pendiente"]);
});

test("cierre de caja: total, cantidad, ticket y comparación con la semana pasada", async () => {
  const { book, vault } = setup();
  vault.deposit(pesosToWei(1000), { timestamp: NOW });
  vault.deposit(pesosToWei(3000), { timestamp: NOW - 3_600_000 });
  vault.deposit(pesosToWei(1600), { timestamp: NOW - 7 * DAY });
  vault.deposit(pesosToWei(9999), { timestamp: NOW - DAY }); // otro día: no cuenta
  crearCobro(book, { monto: 50 }, "x");
  const r = await cierreCaja(book);
  assert.deepEqual([r.total, r.cantidad, r.ticketPromedio, r.totalSemanaPasada, r.variacionPct], [4000, 2, 2000, 1600, 150]);
  assert.match(r.resumen, /Total: \$4\.000/);
  assert.match(r.resumen, /\+150%/);
  assert.match(r.resumen, /Pendientes de confirmar: 1/);
});

test("cierre de caja: sin datos la semana pasada no inventa comparación", async () => {
  const { book } = setup();
  const r = await cierreCaja(book);
  assert.equal(r.variacionPct, null);
  assert.equal(r.cantidad, 0);
  assert.match(r.resumen, /Sin ventas el mismo día/);
});

test("cierre de caja: un día cuenta en hora argentina (23:30 ART sigue siendo hoy)", async () => {
  const { book, vault } = setup();
  const late: Partial<Transfer> = { timestamp: Date.UTC(2026, 9, 21, 2, 30) }; // 23:30 ART del 20
  vault.deposit(pesosToWei(700), late);
  const r = await cierreCaja(new SalesBook(vault, () => Date.UTC(2026, 9, 21, 2, 45)));
  assert.equal(r.total, 700);
});

test("un Transfer anterior a la venta no la cobra: crea su propia venta", async () => {
  const { book, vault } = setup();
  vault.deposit(pesosToWei(500), { timestamp: NOW - 3_600_000 });
  const venta = crearCobro(book, { monto: 500 }, "x");
  await book.reconcile();
  assert.equal(book.sales.find((s) => s.id === venta.ventaId)!.status, "pendiente");
  assert.equal(book.sales.length, 2);
  assert.equal(book.sales[1].status, "cobrada");
});
