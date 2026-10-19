import { isAddress } from "viem";

export function isAllowedVault(vault: string | undefined, env: Record<string, string | undefined> = process.env): vault is string {
  if (!vault || !isAddress(vault)) return false;
  if (env.TILDAI_DEMO === "1") return true;
  return (env.TILDAI_VAULTS ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .includes(vault.toLowerCase());
}
