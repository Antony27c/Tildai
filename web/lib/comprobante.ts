import { createPublicClient, http, parseAbi, parseEventLogs } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { checkVault } from "./vaults.ts";
import { WARS } from "./wars.ts";

type Env = Record<string, string | undefined>;

export type PaymentRow = { to: string; amount: bigint };
export type Comprobante =
  | { kind: "invalid_hash" }
  | { kind: "no_network" }
  | { kind: "unavailable" }
  | { kind: "not_payment" }
  | { kind: "pending" | "confirmed"; rows: PaymentRow[]; blockTime: Date | null; confirmations: number; scan: string };

type Reader = {
  getTransactionReceipt(a: { hash: `0x${string}` }): Promise<any>;
  getBlock(a: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  getBlockNumber(): Promise<bigint>;
  readContract(a: any): Promise<unknown>;
};

const chains = { 42220: celo, 11142220: celoSepolia } as const;
const warsByChain = { 42220: WARS, 11142220: "0x7fd80e16929eac12833c6e214b00efd43ad20e49" } as const;
const scans = { 42220: "https://celoscan.io/tx/", 11142220: "https://celo-sepolia.blockscout.com/tx/" } as const;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const MIN_CONFIRMATIONS = 5;
const erc20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

// Solo lectura onchain: prueba que hubo un Transfer de wARS a un vault de Tildai.
// Nunca dice "cobrada": si la venta quedó anotada lo decide el indexer, no este recibo.
export async function verifyComprobante(txHash: string | undefined, env: Env = process.env, injected?: Reader): Promise<Comprobante> {
  if (!txHash || !TX_RE.test(txHash)) return { kind: "invalid_hash" };
  const chain = chains[Number(env.TILDAI_CHAIN_ID) as keyof typeof chains];
  if (!chain) return { kind: "no_network" };
  const wars = warsByChain[chain.id];
  const reader = injected ?? createPublicClient({ chain, transport: http(env.TILDAI_RPC_URL || undefined) });

  let receipt: any;
  try {
    receipt = await reader.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch (e) {
    // viem tira TransactionReceiptNotFoundError cuando la tx no existe o no está minada.
    if (e instanceof Error && e.name === "TransactionReceiptNotFoundError") return { kind: "not_payment" };
    return { kind: "unavailable" };
  }
  if (!receipt || receipt.status !== "success") return { kind: "not_payment" };

  const events = parseEventLogs({ abi: erc20, logs: receipt.logs ?? [], eventName: "Transfer", strict: false })
    .filter((l) => l.address.toLowerCase() === wars.toLowerCase());
  const okVaults = new Set<string>();
  for (const to of new Set(events.map((e) => String(e.args.to)))) {
    // Un comprobante nunca toma el atajo de TILDAI_DEMO: el vault se valida siempre en la factory.
    const c = await checkVault(to, { ...env, TILDAI_DEMO: undefined }, reader);
    if (c.status === "error") return { kind: "unavailable" }; // no pudimos verificar el destino: no inventamos
    if (c.status === "ok") okVaults.add(to.toLowerCase());
  }
  const rows: PaymentRow[] = [];
  for (const e of events) {
    const to = String(e.args.to);
    if (typeof e.args.value === "bigint" && okVaults.has(to.toLowerCase())) rows.push({ to, amount: e.args.value });
  }
  if (!rows.length) return { kind: "not_payment" };

  let latest: bigint;
  try {
    latest = await reader.getBlockNumber();
  } catch {
    return { kind: "unavailable" };
  }
  const confirmations = Number(latest - receipt.blockNumber + 1n);
  return {
    kind: confirmations >= MIN_CONFIRMATIONS ? "confirmed" : "pending",
    rows,
    blockTime: await blockTime(reader, receipt.blockNumber, receipt.logs ?? []),
    confirmations,
    scan: `${scans[chain.id]}${txHash}`,
  };
}

// La fecha no decide el estado del pago: si el RPC no sirve el bloque va null
// y la página muestra "fecha no disponible". Nunca se estima por número de bloque.
async function blockTime(reader: Reader, blockNumber: bigint, logs: { blockTimestamp?: unknown }[]): Promise<Date | null> {
  // Forno devuelve blockTimestamp en los logs del recibo: si está, es la fecha real.
  const ts = logs.find((l) => l.blockTimestamp != null)?.blockTimestamp;
  if (ts != null) return new Date(Number(ts) * 1000);
  try {
    const block = await reader.getBlock({ blockNumber });
    return new Date(Number(block.timestamp) * 1000);
  } catch {
    return null;
  }
}
