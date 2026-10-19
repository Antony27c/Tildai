import { isAddress } from "viem";

export function buildRipioLink(amount: number, vault: string): string {
  if (!isAddress(vault)) throw new Error("Dirección del comercio inválida");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido");
  const q = new URLSearchParams({
    country: "AR",
    chain: "42220",
    token: "WARS",
    amount: String(amount),
    address: vault,
  });
  return `https://ramp.ripio.com/?${q}`;
}

export function parseAmount(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!/^[\d.,]+$/.test(s)) return null;
  const normalized = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(s)
      ? s.replace(/\./g, "")
      : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : null;
}
