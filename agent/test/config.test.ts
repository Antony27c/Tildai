import assert from "node:assert/strict";
import { test } from "node:test";

import { deberiaAvisar, MAX_RATE, maxRateAlta, numEnv } from "../src/alta.ts";
import { idDeOperacion } from "../src/fondos.ts";
import { pesosToWei } from "../src/money.ts";

function conEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("numEnv: vacío y ausente usan el default; un valor explícito manda", () => {
  conEnv({ TILDAI_MAX_ALTAS_DIA: "" }, () => assert.equal(numEnv("TILDAI_MAX_ALTAS_DIA", "5"), 5));
  conEnv({ TILDAI_MAX_ALTAS_DIA: undefined }, () => assert.equal(numEnv("TILDAI_MAX_ALTAS_DIA", "5"), 5));
  conEnv({ TILDAI_MAX_ALTAS_DIA: "3" }, () => assert.equal(numEnv("TILDAI_MAX_ALTAS_DIA", "5"), 3));
  conEnv({ TILDAI_ALTA_PENDIENTE_MIN: "" }, () => assert.equal(numEnv("TILDAI_ALTA_PENDIENTE_MIN", "30"), 30));
});

test("maxRateAlta: obligatoria en mainnet, con default en Sepolia y tope de cordura", () => {
  conEnv({ TILDAI_MAX_RATE: undefined, TILDAI_NETWORK: "celo" }, () => assert.throws(() => maxRateAlta(), /TILDAI_MAX_RATE/));
  conEnv({ TILDAI_MAX_RATE: "", TILDAI_NETWORK: "celo" }, () => assert.throws(() => maxRateAlta(), /TILDAI_MAX_RATE/)); // vacía tampoco vale
  conEnv({ TILDAI_MAX_RATE: undefined, TILDAI_NETWORK: "celoSepolia" }, () => assert.equal(maxRateAlta(), MAX_RATE));
  conEnv({ TILDAI_MAX_RATE: "2.100", TILDAI_NETWORK: "celo" }, () => assert.equal(maxRateAlta(), pesosToWei(2100)));
  conEnv({ TILDAI_MAX_RATE: "9.999.999", TILDAI_NETWORK: "celoSepolia" }, () => assert.throws(() => maxRateAlta(), /fuera de rango/));
  conEnv({ TILDAI_MAX_RATE: "pepito", TILDAI_NETWORK: "celo" }, () => assert.throws(() => maxRateAlta(), /fuera de rango/));
});

test("deberiaAvisar: una sola respuesta por chat por proceso", () => {
  const avisados = new Set<string>();
  assert.equal(deberiaAvisar("9", avisados), true);
  assert.equal(deberiaAvisar("9", avisados), false);
  assert.equal(deberiaAvisar("9", avisados), false);
  assert.equal(deberiaAvisar("10", avisados), true); // otro chat sí recibe su única respuesta
});

test("idDeOperacion: lo genera el código desde el message_id de Telegram", () => {
  const attrs = { chat_id: "42", message_id: 777, chat_type: "private" };
  assert.equal(idDeOperacion("apartar", attrs, "ahorro", 2000), "apartar:42:777:ahorro:2000");
  assert.equal(idDeOperacion("apartar", attrs, "ahorro", 2000), "apartar:42:777:ahorro:2000"); // reintento del mismo mensaje: mismo id (idempotente)
  assert.notEqual(idDeOperacion("retirar", attrs, 2000), idDeOperacion("apartar", attrs, 2000)); // otra acción, otro id
  assert.notEqual(idDeOperacion("apartar", { ...attrs, message_id: 778 }, "ahorro", 2000), "apartar:42:777:ahorro:2000"); // otro mensaje, otro id
  const sinMsg = idDeOperacion("retirar", { chat_id: "42" }, 500);
  assert.match(sinMsg, /^retirar:42:\d{4}-\d{2}-\d{2}:500$/); // sin message_id cae al día argentino
});
