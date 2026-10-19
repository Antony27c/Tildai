import { createPublicClient, http, isAddress, parseAbi } from "viem";
import { celo, celoSepolia } from "viem/chains";

type Env = Record<string, string | undefined>;
type Reader = { readContract: (args: any) => Promise<unknown> };

export type VaultCheck = { status: "ok" } | { status: "invalid" } | { status: "error"; reason: string };

const abi = parseAbi(["function isVault(address) view returns (bool)"]);
const chains = { 42220: celo, 11142220: celoSepolia } as const;

function chainReader(env: Env): Reader {
  const chain = chains[Number(env.TILDAI_CHAIN_ID) as keyof typeof chains];
  if (!chain) throw new Error("TILDAI_CHAIN_ID debe ser 42220 o 11142220");
  return createPublicClient({ chain, transport: http(env.TILDAI_RPC_URL || undefined) });
}

export async function checkVault(vault: string | undefined, env: Env = process.env, reader?: Reader): Promise<VaultCheck> {
  if (!vault || !isAddress(vault)) return { status: "invalid" };
  if (env.TILDAI_DEMO === "1") return { status: "ok" };
  try {
    const factory = env.TILDAI_FACTORY;
    if (!factory || !isAddress(factory)) throw new Error("TILDAI_FACTORY falta o es inválida");
    const ok = await (reader ?? chainReader(env)).readContract({ address: factory, abi, functionName: "isVault", args: [vault] });
    return ok === true ? { status: "ok" } : { status: "invalid" };
  } catch (e) {
    console.error("checkVault falló", e);
    return { status: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}
