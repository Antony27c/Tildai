import test from "node:test";
import assert from "node:assert/strict";
import { parseSale, payUrl, settledBody } from "./sale.ts";

test("parseSale: opcional, acepta ids simples y rechaza el resto", () => {
  assert.deepEqual(parseSale(null), { ok: true, sale: null });
  assert.deepEqual(parseSale(""), { ok: true, sale: null });
  assert.deepEqual(parseSale("venta-23_A"), { ok: true, sale: "venta-23_A" });
  for (const x of ["a b", "x".repeat(65), "<script>", "a/b"]) assert.deepEqual(parseSale(x), { ok: false });
});

test("payUrl lleva la venta solo si existe", () => {
  const v = "0x498450FE2b46F6b380857b2DE20Df7D52D17F18B";
  assert.equal(payUrl(v, 8500, "s1"), `/api/pay?vault=${v}&amount=8500&sale=s1`);
  assert.equal(payUrl(v, 8500, null), `/api/pay?vault=${v}&amount=8500`);
});

test("settledBody devuelve { saleId, txHash } y lo deja en el log", () => {
  const lines: string[] = [];
  const orig = console.info;
  console.info = (l: string) => void lines.push(l);
  try {
    assert.deepEqual(settledBody("s1", "0xabc", "0xV", 100), { saleId: "s1", txHash: "0xabc" });
  } finally {
    console.info = orig;
  }
  assert.deepEqual(JSON.parse(lines[0]), { event: "x402_settled", saleId: "s1", txHash: "0xabc", vault: "0xV", amount: 100 });
});
