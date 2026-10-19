export type RetryOpts = { retries: number; backoffMs: number; sleep?: (ms: number) => Promise<unknown> };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Reintenta con backoff exponencial; si se agotan los reintentos, lanza el último error.
export async function withRetry<T>(fn: () => Promise<T>, o: RetryOpts): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= o.retries) throw e;
      await (o.sleep ?? wait)(o.backoffMs * 2 ** i);
    }
  }
}

// Recorre [from, to] en tramos de a lo sumo maxRange bloques (forno limita el rango).
// Llama a onChunk tramo a tramo y, si uno falla tras los reintentos, lanza: lo ya procesado queda procesado.
export async function eachChunk(
  from: bigint,
  to: bigint,
  maxRange: bigint,
  onChunk: (from: bigint, to: bigint) => Promise<void>,
) {
  if (maxRange < 1n) throw new Error('maxRange debe ser >= 1');
  for (let a = from; a <= to; ) {
    const b = a + maxRange - 1n < to ? a + maxRange - 1n : to;
    await onChunk(a, b);
    a = b + 1n;
  }
}
