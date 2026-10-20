import { createPublicClient, createWalletClient, custom, http, parseAbi, type Address, type EIP1193Provider } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { withAttribution } from "@celo/attribution-tags";
import { checkVault } from "./vaults.ts";

type Env = Record<string, string | undefined>;
type Reader = { readContract: (a: any) => Promise<unknown> };
type Eip1193 = { request(a: { method: string; params?: unknown }): Promise<unknown> };

// Código asignado por Loops (AGENTS.md regla 2): toda tx que sale del frontend lo lleva.
export const ATTRIBUTION_CODE = "celo_c376b2fd04bc";

export type TokenBalance = { token: Address; symbol: string; decimals: number; balance: string };
export type VaultState =
  | { kind: "invalid" }
  | { kind: "no_network" }
  | { kind: "error" }
  | { kind: "ok"; chainId: number; owner: Address; tokens: TokenBalance[]; scan: string };

export type WithdrawOutcome =
  | { kind: "confirmed"; hash: `0x${string}` }
  | { kind: "rejected" }
  | { kind: "failed"; reason: string };

const chains = { 42220: celo, 11142220: celoSepolia } as const;
const scans = { 42220: "https://celoscan.io/tx/", 11142220: "https://celo-sepolia.blockscout.com/tx/" } as const;
// Direcciones verificadas del repo: contracts/deployments/celo-sepolia.json y fx/index.ts.
const symbols: Record<number, Record<string, string>> = {
  42220: { "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d": "wARS", "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e": "USD₮" },
  11142220: { "0x7fd80e16929eac12833c6e214b00efd43ad20e49": "wARS", "0xa765db30c3079d9ed7c3072832254d0e18f8f721": "USD₮" },
};

export const vaultAbi = parseAbi([
  "function owner() view returns (address)",
  "function wars() view returns (address)",
  "function usdt() view returns (address)",
  "function ownerWithdraw(address token, address to, uint256 amount)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);

export const GAS_MESSAGE = "Necesitás USD₮ o USDC en tu billetera para pagar la comisión (wARS no sirve para eso).";

export const isOwner = (account: string | null | undefined, owner: string) =>
  !!account && account.toLowerCase() === owner.toLowerCase();

// Monto en unidades del token, truncado a 2 decimales (nunca redondea hacia arriba).
const enteros = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
export function formatToken(amount: string | bigint, decimals: number): string {
  const a = BigInt(amount);
  const unit = 10n ** BigInt(decimals);
  const frac = ((a % unit) * 100n) / unit;
  return `${enteros.format(a / unit)},${String(frac).padStart(2, "0")}`;
}

// Solo lectura onchain: valida el vault contra la factory (nunca con el atajo demo)
// y lee owner() y los saldos de los tokens que el propio vault declara (wars, usdt).
export async function loadVault(vault: string | undefined, env: Env = process.env, injected?: Reader): Promise<VaultState> {
  const chain = chains[Number(env.TILDAI_CHAIN_ID) as keyof typeof chains];
  if (!chain) return { kind: "no_network" };
  const check = await checkVault(vault, { ...env, TILDAI_DEMO: undefined }, injected);
  if (check.status === "invalid") return { kind: "invalid" };
  if (check.status === "error") return { kind: "error" };
  const reader = injected ?? createPublicClient({ chain, transport: http(env.TILDAI_RPC_URL || undefined) });
  try {
    const [owner, wars, usdt] = await Promise.all(
      (["owner", "wars", "usdt"] as const).map((fn) => reader.readContract({ address: vault, abi: vaultAbi, functionName: fn })),
    );
    const tokens = await readTokens(reader, String(vault), chain.id, [String(wars) as Address, String(usdt) as Address]);
    return { kind: "ok", chainId: chain.id, owner: String(owner) as Address, tokens, scan: scans[chain.id] };
  } catch {
    return { kind: "error" };
  }
}

// Relee saldos (después de un retiro confirmado, en el navegador). null si el RPC falla.
export async function refreshBalances(chainId: number, vault: Address, tokens: TokenBalance[], injected?: Reader): Promise<TokenBalance[] | null> {
  const chain = chains[chainId as keyof typeof chains];
  if (!chain) return null;
  try {
    const reader = injected ?? createPublicClient({ chain, transport: http() });
    return await Promise.all(
      tokens.map(async (t) => ({ ...t, balance: String(await reader.readContract({ address: t.token, abi: erc20, functionName: "balanceOf", args: [vault] })) })),
    );
  } catch {
    return null;
  }
}

async function readTokens(reader: Reader, vault: string, chainId: number, addrs: Address[]): Promise<TokenBalance[]> {
  const syms = symbols[chainId] ?? {};
  return Promise.all(
    addrs.map(async (token) => {
      const [balance, decimals] = await Promise.all([
        reader.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [vault] }),
        reader.readContract({ address: token, abi: erc20, functionName: "decimals" }),
      ]);
      return { token, symbol: syms[token.toLowerCase()] ?? "Token", decimals: Number(decimals), balance: String(balance) };
    }),
  );
}

type WithdrawDeps = {
  wallet?: { requestAddresses(): Promise<Address[]>; writeContract(a: any): Promise<`0x${string}`> };
  reader?: Reader & { waitForTransactionReceipt(a: { hash: `0x${string}` }): Promise<{ status: string }> };
  onSent?: (hash: `0x${string}`) => void;
};

// El dueño retira TODO el saldo de un token a su propia billetera conectada.
// El gas lo paga su wallet: no se fija feeCurrency, la wallet decide (AGENTS.md: wARS no es fee currency).
export async function withdrawAll(provider: Eip1193, chainId: number, vault: Address, token: Address, deps: WithdrawDeps = {}): Promise<WithdrawOutcome> {
  const chain = chains[chainId as keyof typeof chains];
  if (!chain) return { kind: "failed", reason: "Red no configurada." };
  try {
    const reader = deps.reader ?? createPublicClient({ chain, transport: http() });
    const wallet =
      deps.wallet ?? createWalletClient({ chain, transport: custom(provider as EIP1193Provider) }).extend(withAttribution(ATTRIBUTION_CODE));
    const [account] = await wallet.requestAddresses();
    await ensureChain(provider, chain);
    // El saldo se relee acá, justo antes de firmar: el monto va exacto en la tx.
    const amount = BigInt((await reader.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [vault] })) as bigint);
    if (amount === 0n) return { kind: "failed", reason: "La caja ya no tiene saldo en este token." };
    const hash = await wallet.writeContract({
      account,
      chain,
      address: vault,
      abi: vaultAbi,
      functionName: "ownerWithdraw",
      args: [token, account, amount],
    });
    deps.onSent?.(hash);
    const receipt = await reader.waitForTransactionReceipt({ hash });
    // Recién acá está confirmado: minado y con status success.
    return receipt.status === "success"
      ? { kind: "confirmed", hash }
      : { kind: "failed", reason: "La transacción falló en la red. No se movió nada de tu caja." };
  } catch (e) {
    return mapWithdrawError(e);
  }
}

function mapWithdrawError(e: unknown): WithdrawOutcome {
  const msg = e instanceof Error ? `${e.name} ${e.message} ${(e as { cause?: { message?: string } }).cause?.message ?? ""}` : String(e);
  if (/user.?reject|denied|4001/i.test(msg)) return { kind: "rejected" };
  if (/insufficient funds|exceeds the balance|not enough|out of gas|gas/i.test(msg)) return { kind: "failed", reason: GAS_MESSAGE };
  return { kind: "failed", reason: "No pudimos completar el retiro. No se movió nada de tu caja." };
}

async function ensureChain(provider: Eip1193, chain: (typeof celo) | (typeof celoSepolia)) {
  const hex = `0x${chain.id.toString(16)}`;
  if ((await provider.request({ method: "eth_chainId" })) === hex) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex,
          chainName: chain.name,
          rpcUrls: [...chain.rpcUrls.default.http],
          nativeCurrency: chain.nativeCurrency,
          blockExplorerUrls: [chain.blockExplorers.default.url],
        },
      ],
    });
  }
}
