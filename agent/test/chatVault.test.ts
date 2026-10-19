import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Env must be set before runtime.ts is imported (it reads module-level values).
const dir = mkdtempSync(join(tmpdir(), "tildai-"));
process.env.TILDAI_REGISTRY = join(dir, "chats.json");
process.env.TILDAI_OWNER_CHAT_ID = "owner-1";
process.env.TILDAI_VAULT = "0x5555555555555555555555555555555555555555";
process.env.TILDAI_FROM_BLOCK = "42";

const rt = await import("../src/runtime.ts");

const ctxDe = (chatId: string) => ({ session: { auth: { current: { attributes: { chat_id: chatId, chat_type: "private" } } } } });

test("un chat sin vault propio no puede tocar fondos ni ventas", async () => {
  assert.throws(() => rt.vaultDelChat(ctxDe("extraño-1")), /hacé \/start/);
  assert.throws(() => rt.bookDelChat(ctxDe("extraño-1")), /hacé \/start/);
});

test("sin sesión de Telegram no se resuelve ningún vault", () => {
  assert.throws(() => rt.vaultDelChat({}), /solo funciona desde un chat/);
  assert.throws(() => rt.vaultDelChat({ session: { auth: { current: null } } }), /solo funciona desde un chat/);
});

test("el chat del dueño configurado puede usar el vault de env", () => {
  assert.equal(rt.vaultDelChat(ctxDe("owner-1")).address, "0x5555555555555555555555555555555555555555");
  assert.equal(rt.vaultDelChat(ctxDe("owner-1")).fromBlock, 42n);
});

test("un chat con vault propio usa el suyo, nunca el de env", async () => {
  await rt.chatRegistry().set("comerciante-2", {
    estado: "creado",
    owner: "0x1111111111111111111111111111111111111111",
    dailyCap: "100",
    vault: "0x6666666666666666666666666666666666666666",
    fromBlock: "99",
    at: 0,
  });
  const v = rt.vaultDelChat(ctxDe("comerciante-2"));
  assert.equal(v.address, "0x6666666666666666666666666666666666666666");
  assert.equal(v.fromBlock, 99n);
  rmSync(dir, { recursive: true });
});

test("un grupo no es un chat válido para plata", () => {
  const group = { session: { auth: { current: { attributes: { chat_id: "g-1", chat_type: "group" } } } } };
  assert.throws(() => rt.vaultDelChat(group), /por privado/);
});
