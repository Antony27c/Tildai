import test from "node:test";
import assert from "node:assert/strict";
import { createWalletClient, custom, encodeFunctionData, toHex, type Address } from "viem";
import { celoSepolia } from "viem/chains";
import { fromDataSuffix, withAttribution } from "@celo/attribution-tags";
import { ATTRIBUTION_CODE, formatToken, GAS_MESSAGE, isOwner, loadVault, refreshBalances, vaultAbi, withdrawAll } from "./retirar.ts";

const VAULT = `0x${"11".repeat(20)}` as Address;
const NOT_VAULT = `0x${"66".repeat(20)}` as Address;
const OWNER = `0x${"22".repeat(20)}` as Address;
const OTHER = `0x${"33".repeat(20)}` as Address;
const WARS_SEP = "0x7fd80e16929eac12833c6e214b00efd43ad20e49";
const USDT_SEP = "0xa765db30c3079d9ed7c3072832254d0e18f8f721";
const FACTORY = `0x${"55".repeat(20)}`;
const SEPOLIA = { TILDAI_CHAIN_ID: "11142220", TILDAI_FACTORY: FACTORY };
const HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const BAL = 5n * 10n ** 18n;

// Reader falso: isVault de la factory + owner/wars/usdt del vault + balanceOf/decimals de los tokens.
const reader = (o: { isVault?: boolean; balance?: bigint } = {}) => ({
  readContract: async (a: any) => {
    if (a.functionName === "isVault") return o.isVault ?? true;
    if (a.functionName === "owner") return OWNER;
    if (a.functionName === "wars") return WARS_SEP;
    if (a.functionName === "usdt") return USDT_SEP;
    if (a.functionName === "balanceOf") return o.balance ?? BAL;
    if (a.functionName === "decimals") return a.address === WARS_SEP ? 18 : 6;
    throw new Error(`readContract no esperado: ${a.functionName}`);
  },
});

// Provider EIP-1193 falso: responde lo que viem pide para mandar la tx y guarda el calldata enviado.
const provider = (o: { chainId?: number; account?: string; sendError?: unknown; onSend?: (tx: any) => void } = {}) => ({
  request: async ({ method, params }: { method: string; params?: any }) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [o.account ?? OWNER];
      case "eth_chainId":
        return toHex(o.chainId ?? 11142220);
      case "eth_estimateGas":
        return toHex(100_000);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return toHex(1_000_000_000);
      case "eth_getBlockByNumber":
        return { number: "0x1", hash: `0x${"11".repeat(32)}`, baseFeePerGas: toHex(1_000_000_000), timestamp: "0x1", gasLimit: toHex(20_000_000), transactions: [] };
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_sendTransaction":
        if (o.sendError) throw o.sendError;
        o.onSend?.(params[0]);
        return HASH;
      default:
        throw new Error(`RPC no esperado en el test: ${method}`);
    }
  },
});

// Wallet real (viem + custom transport + withAttribution): el mismo camino de código que el navegador.
const taggedWallet = (p: ReturnType<typeof provider>) =>
  createWalletClient({ chain: celoSepolia, transport: custom(p as any) }).extend(withAttribution(ATTRIBUTION_CODE));

const receiptReader = (status: string, balance = BAL) => ({
  ...reader({ balance }),
  waitForTransactionReceipt: async () => ({ status }),
});

test("loadVault: vault real devuelve owner y saldos de wARS y USD₮", async () => {
  const r = await loadVault(VAULT, SEPOLIA, reader());
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.owner, OWNER);
  assert.equal(r.chainId, 11142220);
  assert.deepEqual(
    r.tokens.map((t) => t.symbol),
    ["wARS", "USD₮"],
  );
  assert.equal(r.tokens[0].balance, BAL.toString());
});

test("loadVault: no es vault de la factory → invalid, también con TILDAI_DEMO=1", async () => {
  // checkVault cachea los "ok" por dirección: este caso usa una dirección que nunca dio ok.
  assert.equal((await loadVault(NOT_VAULT, SEPOLIA, reader({ isVault: false }))).kind, "invalid");
  assert.equal((await loadVault(NOT_VAULT, { ...SEPOLIA, TILDAI_DEMO: "1" }, reader({ isVault: false }))).kind, "invalid");
});

test("loadVault: RPC caído o red sin configurar → error / no_network", async () => {
  const boom = { readContract: async () => { throw new Error("timeout"); } };
  assert.equal((await loadVault(VAULT, SEPOLIA, boom)).kind, "error");
  assert.equal((await loadVault(VAULT, {}, boom)).kind, "no_network");
});

test("isOwner: otra billetera no es la dueña (la página no ofrece firmar)", async () => {
  assert.equal(isOwner(OTHER, OWNER), false);
  assert.equal(isOwner(null, OWNER), false);
  assert.equal(isOwner(OWNER.toUpperCase().replace("0X", "0x"), OWNER), true);
});

test("owner firma: ownerWithdraw al vault, al dueño, con el saldo releído y el tag ERC-8021", async () => {
  let sent: any;
  const p = provider({ onSend: (tx) => (sent = tx) });
  const r = await withdrawAll(p, 11142220, VAULT, WARS_SEP, { wallet: taggedWallet(p), reader: receiptReader("success") });
  assert.equal(r.kind, "confirmed");
  if (r.kind !== "confirmed") return;
  assert.equal(r.hash, HASH);
  // La tx va al vault, desde la cuenta del dueño, y el calldata es ownerWithdraw(token, account, saldo).
  assert.equal(sent.to.toLowerCase(), VAULT);
  assert.equal(sent.from.toLowerCase(), OWNER);
  const call = encodeFunctionData({ abi: vaultAbi, functionName: "ownerWithdraw", args: [WARS_SEP, OWNER, BAL] });
  assert.ok(sent.data.startsWith(call), `calldata esperado: ${call}…`);
  assert.deepEqual(fromDataSuffix(sent.data)?.codes, [ATTRIBUTION_CODE]);
});

test("el usuario rechaza la firma: 'rejected', no es un error", async () => {
  const p = provider({ sendError: Object.assign(new Error("User rejected the request"), { code: 4001 }) });
  const r = await withdrawAll(p, 11142220, VAULT, WARS_SEP, { wallet: taggedWallet(p), reader: receiptReader("success") });
  assert.equal(r.kind, "rejected");
});

test("recibo revertido: error, nunca 'confirmado'", async () => {
  const p = provider();
  const r = await withdrawAll(p, 11142220, VAULT, WARS_SEP, { wallet: taggedWallet(p), reader: receiptReader("reverted") });
  assert.deepEqual(r, { kind: "failed", reason: "La transacción falló en la red. No se movió nada de tu caja." });
});

test("la espera del recibo falla después de enviar: 'unknown' con el hash, nunca 'no se movió nada'", async () => {
  const p = provider();
  const r = await withdrawAll(p, 11142220, VAULT, WARS_SEP, {
    wallet: taggedWallet(p),
    reader: { ...reader(), waitForTransactionReceipt: async () => { throw new Error("timeout"); } },
  });
  assert.equal(r.kind, "unknown");
  if (r.kind === "unknown") assert.equal(r.hash, HASH);
});

test("sin saldo para la comisión: mensaje pide USD₮ o USDC (wARS no sirve)", async () => {
  const p = provider({ sendError: new Error("insufficient funds for gas * price + value") });
  const r = await withdrawAll(p, 11142220, VAULT, WARS_SEP, { wallet: taggedWallet(p), reader: receiptReader("success") });
  assert.deepEqual(r, { kind: "failed", reason: GAS_MESSAGE });
});

test("revert en la estimación de gas: mensaje genérico, no el de comisión", async () => {
  const err = Object.assign(new Error("EstimateGasExecutionError: execution reverted: NotOwner()"), { name: "EstimateGasExecutionError" });
  const p = provider({ sendError: err });
  const r = await withdrawAll(p, 11142220, VAULT, WARS_SEP, { wallet: taggedWallet(p), reader: receiptReader("success") });
  assert.deepEqual(r, { kind: "failed", reason: "No pudimos completar el retiro. No se movió nada de tu caja." });
});

test("saldo cero al releer o red distinta: no se firma nada", async () => {
  const p = provider({ onSend: () => assert.fail("no debería enviar tx") });
  const r = await withdrawAll(p, 11142220, VAULT, WARS_SEP, { wallet: taggedWallet(p), reader: receiptReader("success", 0n) });
  assert.equal(r.kind, "failed");
  const bad = await withdrawAll(provider(), 1, VAULT, WARS_SEP);
  assert.deepEqual(bad, { kind: "failed", reason: "Red no configurada." });
});

test("refreshBalances: relee los saldos; RPC caído → null", async () => {
  const tokens = [
    { token: WARS_SEP as Address, symbol: "wARS", decimals: 18, balance: "0" },
    { token: USDT_SEP as Address, symbol: "USD₮", decimals: 6, balance: "0" },
  ];
  const fresh = await refreshBalances(11142220, VAULT, tokens, reader({ balance: 42n }));
  assert.equal(fresh?.[0].balance, "42");
  const boom = { readContract: async () => { throw new Error("timeout"); } };
  assert.equal(await refreshBalances(11142220, VAULT, tokens, boom), null);
});

test("formatToken: trunca a 2 decimales en cualquier token", async () => {
  assert.equal(formatToken(1_234_567_890_000_000_000_000n, 18), "1.234,56");
  assert.equal(formatToken(1_999_999n, 6), "1,99");
  assert.equal(formatToken(0n, 6), "0,00");
});
