import test from "node:test";
import assert from "node:assert/strict";
import { cartelBase, counterUrl, sanitizeNombre } from "./cartel.ts";

const hdrs = (m: Record<string, string | null>) => ({ get: (k: string) => m[k] ?? null });

test("sanitizeNombre: recorta a 40, quita control/formato y descarta vacío", () => {
  assert.equal(sanitizeNombre(undefined), undefined);
  assert.equal(sanitizeNombre("   "), undefined);
  assert.equal(sanitizeNombre("  Almacén Don José  "), "Almacén Don José");
  assert.equal(sanitizeNombre("A".repeat(60)), "A".repeat(40));
  assert.equal(sanitizeNombre("Kiosco\t\u0000El\nTano"), "KioscoElTano");
  assert.equal(sanitizeNombre("Kiosco \u202E invertido"), "Kiosco  invertido");
  // El HTML no se escapa acá: React lo renderiza como texto (el <b> sale literal, sin efecto).
  assert.equal(sanitizeNombre("<b>Don José</b>"), "<b>Don José</b>");
});

test("counterUrl: <base>/?vault=<vault>, igual que el QR del mostrador", () => {
  assert.equal(counterUrl("0xAbC", "https://tildai.example"), "https://tildai.example/?vault=0xAbC");
  assert.equal(counterUrl("0xAbC", "https://tildai.example/"), "https://tildai.example/?vault=0xAbC");
});

test("cartelBase: NEXT_PUBLIC_BASE_URL o el host del pedido", () => {
  assert.equal(cartelBase({ NEXT_PUBLIC_BASE_URL: "https://tildai.example" }, hdrs({ host: "x" })), "https://tildai.example");
  assert.equal(cartelBase({}, hdrs({ "x-forwarded-proto": "https", host: "tildai.example" })), "https://tildai.example");
  assert.equal(cartelBase({}, hdrs({ host: "localhost:3000" })), "http://localhost:3000");
});
