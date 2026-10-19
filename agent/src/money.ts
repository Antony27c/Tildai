const CENT = 10n ** 16n; // wARS has 18 decimals
export const MAX_COBRO_PESOS = 1_000_000;

export function pesosToWei(pesos: number): bigint {
  if (!Number.isFinite(pesos) || pesos <= 0) throw new Error("El monto tiene que ser mayor a 0");
  if (pesos > MAX_COBRO_PESOS) throw new Error(`El monto supera el tope de $${MAX_COBRO_PESOS} por cobro`);
  const cents = Math.round(pesos * 100);
  if (Math.abs(pesos * 100 - cents) > 1e-6) throw new Error("El monto admite hasta 2 decimales");
  return BigInt(cents) * CENT;
}

export function weiToPesos(wei: bigint): number {
  return Number(wei / CENT) / 100;
}

export function formatPesos(wei: bigint): string {
  return `$${weiToPesos(wei).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}
