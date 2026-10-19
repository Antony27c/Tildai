import { createPublicClient, http, parseAbi } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { WARS } from "./wars.ts";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
type Reader = { readContract: (args: any) => Promise<unknown> };

export type PanelSale = { id: string; amount: string; status: "pendiente" | "cobrada"; createdAt: number; txHash?: string };
export type PanelPayment = { id: string; from: string; amount: string; txHash: string; timestamp: number | null; saleId?: string };
export type PanelData = { ok: true; sales: PanelSale[]; payments: PanelPayment[] } | { ok: false };

const DAY = 86_400_000;
const AR_OFFSET = 3 * 3_600_000; // Argentina es UTC-3 todo el año, sin DST

// [since, until) en ms: el día civil en Argentina (de 00:00 a 00:00 locales) que contiene `now`.
export function dayRangeAR(now: number): { since: number; until: number } {
  const since = Math.floor((now - AR_OFFSET) / DAY) * DAY + AR_OFFSET;
  return { since, until: since + DAY };
}

const PESO = 10n ** 18n;
const intFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

// wARS (18 decimales) → "1.234,56". Sin float: redondeo al centavo más cercano con bigint.
export function formatPesos(wei: string | bigint): string {
  const cents = (BigInt(wei) * 100n + PESO / 2n) / PESO;
  return `${intFmt.format(cents / 100n)},${(cents % 100n).toString().padStart(2, "0")}`;
}

const horaFmt = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const formatHoraAR = (ms: number): string => horaFmt.format(ms);

const digits = (x: unknown): x is string => typeof x === "string" && /^\d+$/.test(x);
const isSale = (x: any): x is PanelSale =>
  x && typeof x.id === "string" && digits(x.amount) && (x.status === "pendiente" || x.status === "cobrada") && typeof x.createdAt === "number";
const isPayment = (x: any): x is PanelPayment =>
  x && digits(x.amount) && typeof x.txHash === "string" && (x.timestamp === null || typeof x.timestamp === "number");

// El token queda en el servidor: esta función solo corre en el server component.
// Un dato inválido o una respuesta a medias (503 = pagos sin timestamp) rompe todo: nunca números inventados.
export async function fetchPanel(vault: string, since: number, until: number, env: Env = process.env, f: Fetch = fetch): Promise<PanelData> {
  try {
    const base = env.TILDAI_INDEXER_URL;
    const token = env.TILDAI_INDEXER_TOKEN;
    if (!base || !token) throw new Error("Faltan TILDAI_INDEXER_URL o TILDAI_INDEXER_TOKEN");
    const q = `vault=${encodeURIComponent(vault)}&since=${since}&until=${until}`;
    const init: RequestInit = { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(5000) };
    const [rs, rp] = await Promise.all([f(new URL(`/sales?${q}`, base), init), f(new URL(`/payments?${q}`, base), init)]);
    if (!rs.ok || !rp.ok) throw new Error(`el indexer respondió ${rs.status}/${rp.status}`);
    const [sales, payments] = await Promise.all([rs.json(), rp.json()]);
    if (!Array.isArray(sales) || !sales.every(isSale) || !Array.isArray(payments) || !payments.every(isPayment)) {
      throw new Error("respuesta del indexer con forma inesperada");
    }
    return { ok: true, sales, payments };
  } catch (e) {
    console.error(JSON.stringify({ event: "panel_fetch_failed", vault, reason: e instanceof Error ? e.message : String(e) }));
    return { ok: false };
  }
}

export function summarize(sales: PanelSale[], payments: PanelPayment[]) {
  let totalWei = 0n;
  for (const p of payments) totalWei += BigInt(p.amount);
  const cobradas = sales.filter((s) => s.status === "cobrada").length;
  return { totalWei, pagos: payments.length, cobradas, pendientes: sales.length - cobradas };
}

const chains = { 42220: celo, 11142220: celoSepolia } as const;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

function chainReader(env: Env): Reader {
  const chain = chains[Number(env.TILDAI_CHAIN_ID) as keyof typeof chains];
  if (!chain) throw new Error("TILDAI_CHAIN_ID debe ser 42220 o 11142220");
  return createPublicClient({ chain, transport: http(env.TILDAI_RPC_URL || undefined) });
}

// null = no se pudo leer: la página muestra "No disponible", nunca $0.
export async function readVaultBalance(vault: string, env: Env = process.env, reader?: Reader): Promise<bigint | null> {
  try {
    const b = await (reader ?? chainReader(env)).readContract({ address: WARS, abi: erc20, functionName: "balanceOf", args: [vault] });
    return typeof b === "bigint" ? b : null;
  } catch (e) {
    console.error("readVaultBalance falló", e);
    return null;
  }
}
