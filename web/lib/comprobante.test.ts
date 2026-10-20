import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, parseAbi } from "viem";
import { verifyComprobante } from "./comprobante.ts";
import { formatPesos } from "./stats.ts";
import { WARS } from "./wars.ts";

const TX: `0x${string}` = `0x${"ab".repeat(32)}`;
const VAULT: `0x${string}` = `0x${"11".repeat(20)}`;
const VAULT2: `0x${string}` = `0x${"22".repeat(20)}`;
const PAYER: `0x${string}` = `0x${"33".repeat(20)}`;
const OTRO_TOKEN: `0x${string}` = `0x${"44".repeat(20)}`;
const WARS_SEPOLIA = "0x7fd80e16929eac12833c6e214b00efd43ad20e49";
const FACTORY = `0x${"55".repeat(20)}`;
const SEPOLIA = { TILDAI_CHAIN_ID: "11142220", TILDAI_FACTORY: FACTORY };

const erc20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const tlog = (address: `0x${string}`, to: `0x${string}`, value: bigint, from: `0x${string}` = PAYER) => ({
  address,
  topics: encodeEventTopics({ abi: erc20, eventName: "Transfer", args: { from, to } }),
  data: `0x${value.toString(16).padStart(64, "0")}`,
});
const notFound = () => Object.assign(new Error("receipt could not be found"), { name: "TransactionReceiptNotFoundError" });
const receipt = (logs: unknown[], status = "success", blockNumber = 96n) => ({ status, blockNumber, logs });

type Opts = { receipt?: unknown; receiptError?: Error; latest?: bigint; timestamp?: bigint; vaults?: Set<string> };
const reader = (o: Opts) => ({
  getTransactionReceipt: async () => {
    if (o.receiptError) throw o.receiptError;
    return o.receipt ?? null;
  },
  getBlockNumber: async () => o.latest ?? 100n,
  getBlock: async () => ({ timestamp: o.timestamp ?? 1_760_000_000n }),
  readContract: async ({ args }: { args: unknown[] }) => (o.vaults ?? new Set([VAULT])).has(String(args[0]).toLowerCase()),
});
const boom = () => ({ getTransactionReceipt: async () => { throw new Error("no debería llamarse"); } }) as any;

test("hash inválido: no toca la red", async () => {
  for (const h of [undefined, "", "0x123", `0x${"zz".repeat(32)}`, TX.slice(0, -1)]) {
    assert.equal((await verifyComprobante(h, SEPOLIA, boom())).kind, "invalid_hash");
  }
});

test("red no configurada: sin TILDAI_CHAIN_ID o con otra red, sin tocar RPC", async () => {
  assert.equal((await verifyComprobante(TX, {}, boom())).kind, "no_network");
  assert.equal((await verifyComprobante(TX, { TILDAI_CHAIN_ID: "1" }, boom())).kind, "no_network");
  assert.equal((await verifyComprobante(TX, { TILDAI_CHAIN_ID: "" }, boom())).kind, "no_network");
});

test("tx inexistente, revertida o sin Transfer de wARS a vault: no prueba un pago", async () => {
  assert.equal((await verifyComprobante(TX, SEPOLIA, reader({ receiptError: notFound() }))).kind, "not_payment");
  assert.equal((await verifyComprobante(TX, SEPOLIA, reader({ receipt: null }))).kind, "not_payment");
  assert.equal((await verifyComprobante(TX, SEPOLIA, reader({ receipt: receipt([], "reverted") }))).kind, "not_payment");
  assert.equal((await verifyComprobante(TX, SEPOLIA, reader({ receipt: receipt([]) }))).kind, "not_payment");
  assert.equal((await verifyComprobante(TX, SEPOLIA, reader({ receipt: receipt([tlog(OTRO_TOKEN, VAULT, 10n ** 18n)]) }))).kind, "not_payment");
  assert.equal((await verifyComprobante(TX, SEPOLIA, reader({ receipt: receipt([tlog(WARS_SEPOLIA, PAYER, 10n ** 18n)]) }))).kind, "not_payment");
});

test("RPC caído: 'unavailable', nunca un estado inventado", async () => {
  assert.equal((await verifyComprobante(TX, SEPOLIA, reader({ receiptError: new Error("ECONNREFUSED") }))).kind, "unavailable");
  const res = await verifyComprobante(TX, SEPOLIA, {
    ...reader({ receipt: receipt([tlog(WARS_SEPOLIA, VAULT, 10n ** 18n)]) }),
    getBlockNumber: async () => { throw new Error("timeout"); },
  });
  assert.equal(res.kind, "unavailable");
});

test("menos de 5 confirmaciones: 'pending', no confirmado", async () => {
  const r = await verifyComprobante(TX, SEPOLIA, reader({ receipt: receipt([tlog(WARS_SEPOLIA, VAULT, 10n ** 18n)]), latest: 97n }));
  assert.equal(r.kind, "pending");
  if (r.kind === "pending") assert.equal(r.confirmations, 2);
});

test("confirmada: 5+ confirmaciones, monto bigint, vault y scan de Sepolia", async () => {
  const r = await verifyComprobante(TX, SEPOLIA, reader({ receipt: receipt([tlog(WARS_SEPOLIA, VAULT, 1_234_567_890_000_000_000_000n)]), latest: 100n }));
  assert.equal(r.kind, "confirmed");
  if (r.kind !== "confirmed") return;
  assert.equal(r.confirmations, 5);
  assert.deepEqual(r.rows, [{ to: VAULT, amount: 1_234_567_890_000_000_000_000n }]);
  assert.equal(r.scan, `https://celo-sepolia.blockscout.com/tx/${TX}`);
  assert.equal(r.blockTime?.toISOString(), "2025-10-09T08:53:20.000Z");
  assert.equal(formatPesos(String(r.rows[0].amount)), "$ 1.234,56"); // trunca, no redondea
});

test("varios Transfer a vaults: uno por fila; mezclados con no-vault solo cuentan los válidos", async () => {
  const logs = [
    tlog(WARS_SEPOLIA, VAULT, 10n ** 18n),
    tlog(WARS_SEPOLIA, VAULT2, 2n * 10n ** 18n),
    tlog(WARS_SEPOLIA, PAYER, 5n * 10n ** 18n), // destino que no es vault: afuera
  ];
  const r = await verifyComprobante(TX, SEPOLIA, reader({ receipt: receipt(logs), vaults: new Set([VAULT, VAULT2]) }));
  assert.equal(r.kind, "confirmed");
  if (r.kind === "confirmed") assert.equal(r.rows.length, 2);
});

test("bloque podado en el RPC: confirmado igual, con fecha no disponible", async () => {
  const r = await verifyComprobante(TX, SEPOLIA, {
    ...reader({ receipt: receipt([tlog(WARS_SEPOLIA, VAULT, 10n ** 18n)]) }),
    getBlock: async () => { throw new Error("block is more than 10064 blocks behind head"); },
  });
  assert.equal(r.kind, "confirmed");
  if (r.kind === "confirmed") assert.equal(r.blockTime, null);
});

test("log con blockTimestamp: fecha del log aunque el bloque esté podado", async () => {
  const log = { ...tlog(WARS_SEPOLIA, VAULT, 10n ** 18n), blockTimestamp: 1_770_000_000n };
  const r = await verifyComprobante(TX, SEPOLIA, {
    ...reader({ receipt: receipt([log]) }),
    getBlock: async () => { throw new Error("pruned"); },
  });
  assert.equal(r.kind, "confirmed");
  if (r.kind === "confirmed") assert.equal(r.blockTime?.getTime(), 1_770_000_000_000);
});

test("TILDAI_DEMO=1 no relaja el comprobante: destino que no es vault sigue siendo not_payment", async () => {
  const r = await verifyComprobante(TX, { ...SEPOLIA, TILDAI_DEMO: "1" }, reader({ receipt: receipt([tlog(WARS_SEPOLIA, PAYER, 10n ** 18n)]) }));
  assert.equal(r.kind, "not_payment");
});

test("mainnet: usa la constante WARS y Celoscan", async () => {
  const env = { TILDAI_CHAIN_ID: "42220", TILDAI_FACTORY: FACTORY };
  const r = await verifyComprobante(TX, env, reader({ receipt: receipt([tlog(WARS, VAULT, 10n ** 18n)]) }));
  assert.equal(r.kind, "confirmed");
  if (r.kind === "confirmed") assert.equal(r.scan, `https://celoscan.io/tx/${TX}`);
});
