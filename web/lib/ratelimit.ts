// Ventana deslizante en memoria.
// shortcut: por instancia, pasar a KV/WAF si hay más de una instancia
const buckets = new Map<string, number[]>();
const WINDOW_MS = 60_000;

export function rateLimit(key: string, limit: number, now = Date.now()): boolean {
  if (buckets.size > 5000) {
    for (const [k, hits] of buckets) if (!hits.length || now - hits[hits.length - 1] > WINDOW_MS) buckets.delete(k);
  }
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
