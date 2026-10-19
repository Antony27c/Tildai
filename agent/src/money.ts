const CENT = 10n ** 16n; // wARS has 18 decimals
export const MAX_COBRO_PESOS = 1_000_000;
export const MAX_TOPE_PESOS = 10_000_000; // daily vault cap ceiling (own limit, not MAX_COBRO_PESOS)

export function pesosToWei(pesos: number, max = MAX_COBRO_PESOS): bigint {
  if (!Number.isFinite(pesos) || pesos <= 0) throw new Error("El monto tiene que ser mayor a 0");
  if (pesos > max) throw new Error(`El monto supera el tope de $${max.toLocaleString("es-AR")}`);
  const cents = Math.round(pesos * 100);
  if (Math.abs(pesos * 100 - cents) > 1e-6) throw new Error("El monto admite hasta 2 decimales");
  return BigInt(cents) * CENT;
}

/** Deterministic argentine amount parse ("8.500" = 8500, comma = decimals): the model passes raw text, never a number it interpreted. */
export function parsePesosTexto(raw: string): number | null {
  const s = raw.trim().replace(/^\$+/, "").trim();
  if (!/^[\d.,]+$/.test(s)) return null;
  const normalized = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(s)
      ? s.replace(/\./g, "")
      : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 && n <= MAX_TOPE_PESOS ? Math.round(n * 100) / 100 : null;
}

export function weiToPesos(wei: bigint): number {
  return Number(wei / CENT) / 100;
}

export function formatPesos(wei: bigint): string {
  return `$${weiToPesos(wei).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}
