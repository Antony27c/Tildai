type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export type DayStats = { day: string; payments: number; warsReceived: string };
export type Stats = {
  vaults: number;
  activeVaults7d: number;
  payments: number;
  salesCobradas: number;
  warsReceived: string;
  paymentsWithoutTimestamp: number;
  byDay: DayStats[];
  generatedAt: string;
};
export type StatsResult = { ok: true; stats: Stats } | { ok: false; reason: string };

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isWei = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

// Contrato de GET /stats del indexer. Si falta o sobra forma, null: nunca ceros inventados.
export function parseStats(body: unknown): Stats | null {
  if (typeof body !== "object" || body === null) return null;
  const s = body as Record<string, unknown>;
  if (!isCount(s.vaults) || !isCount(s.activeVaults7d) || !isCount(s.payments) ||
      !isCount(s.salesCobradas) || !isWei(s.warsReceived) || !isCount(s.paymentsWithoutTimestamp) ||
      typeof s.generatedAt !== "string" || !s.generatedAt) return null;
  if (!Array.isArray(s.byDay)) return null;
  const byDay: DayStats[] = [];
  for (const item of s.byDay) {
    if (typeof item !== "object" || item === null) return null;
    const d = item as Record<string, unknown>;
    if (typeof d.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.day) || !isCount(d.payments) || !isWei(d.warsReceived)) return null;
    byDay.push({ day: d.day, payments: d.payments, warsReceived: d.warsReceived });
  }
  return {
    vaults: s.vaults, activeVaults7d: s.activeVaults7d, payments: s.payments,
    salesCobradas: s.salesCobradas, warsReceived: s.warsReceived,
    paymentsWithoutTimestamp: s.paymentsWithoutTimestamp, byDay, generatedAt: s.generatedAt,
  };
}

const PESO = 10n ** 18n;
const enteros = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

// wei (string) a pesos con bigint, nunca float. Decimales truncados a 2, sin redondear.
export function formatPesos(wei: string): string {
  const w = BigInt(wei);
  return `$ ${enteros.format(w / PESO)},${String((w % PESO) / (PESO / 100n)).padStart(2, "0")}`;
}

export function networkName(env: Env = process.env): string {
  const id = env.TILDAI_CHAIN_ID ?? "42220";
  return id === "11142220" ? "Celo Sepolia" : id === "42220" ? "Celo mainnet" : `chain ${id}`;
}

// El token solo vive en el servidor: esta función corre en el server component, no en el cliente.
export async function fetchStats(env: Env = process.env, f: Fetch = fetch): Promise<StatsResult> {
  const base = env.TILDAI_INDEXER_URL;
  const token = env.TILDAI_INDEXER_TOKEN;
  if (!base || !token) return { ok: false, reason: "Faltan TILDAI_INDEXER_URL o TILDAI_INDEXER_TOKEN" };
  try {
    const res = await f(new URL("/stats", base), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return { ok: false, reason: `El indexer respondió ${res.status}` };
    const stats = parseStats(await res.json());
    if (!stats) return { ok: false, reason: "El indexer respondió con un formato inesperado" };
    return { ok: true, stats };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
