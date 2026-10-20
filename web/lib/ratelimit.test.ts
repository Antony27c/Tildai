import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "./ratelimit.ts";

test("rateLimit: ventana deslizante por clave", () => {
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(rateLimit("ip:a", 5, t), true);
  assert.equal(rateLimit("ip:a", 5, t), false);
  assert.equal(rateLimit("ip:b", 5, t), true);
  assert.equal(rateLimit("ip:a", 5, t + 61_000), true);
});
