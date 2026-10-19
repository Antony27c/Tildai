export function parseSale(raw: string | null | undefined): { ok: true; sale: string | null } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, sale: null };
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? { ok: true, sale: raw } : { ok: false };
}

export function payUrl(vault: string, amount: number, sale: string | null): string {
  const q = new URLSearchParams({ vault, amount: String(amount) });
  if (sale) q.set("sale", sale);
  return `/api/pay?${q}`;
}

// No marca la venta como cobrada: solo la correlaciona con el hash. Confirma el indexer, por hash de tx.
export function settledBody(saleId: string | null, txHash: string, vault: string, amount: number) {
  console.info(JSON.stringify({ event: "x402_settled", saleId, txHash, vault, amount }));
  return { saleId, txHash };
}
