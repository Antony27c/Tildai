export type PollOutcome = "cobrada" | "timeout" | "cancelled";

export async function pollSale(
  saleId: string,
  { f = fetch, intervalMs = 4000, maxMs = 180_000, signal }: { f?: typeof fetch; intervalMs?: number; maxMs?: number; signal?: AbortSignal } = {},
): Promise<PollOutcome> {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    if (signal?.aborted) return "cancelled";
    try {
      const res = await f(`/api/sale/${encodeURIComponent(saleId)}`);
      if (res.ok && ((await res.json()) as { status?: string }).status === "cobrada") return "cobrada";
    } catch {
      // error de red transitorio: se sigue consultando hasta el tiempo máximo
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return signal?.aborted ? "cancelled" : "timeout";
}
