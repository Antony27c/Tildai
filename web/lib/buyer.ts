import { createPublicClient, createWalletClient, custom, http, parseAbi, type EIP1193Provider } from "viem";
import { celo } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { payUrl } from "./sale.ts";
import { GENERIC, hasWallet, mapPayError, NETWORK, NO_BALANCE, WARS, warsAtomic, type WalletCheck } from "./wars.ts";

export type PayOutcome = { ok: true; txHash: string } | { ok: false; reason: string };

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const readBalance = (pc: { readContract: Function }, account: `0x${string}`) =>
  pc.readContract({ address: WARS, abi: erc20, functionName: "balanceOf", args: [account] }) as Promise<bigint>;

export async function checkWarsWallet(ethereum: unknown, amount: number): Promise<WalletCheck> {
  if (!hasWallet(ethereum)) return "no_wallet";
  try {
    const provider = ethereum as EIP1193Provider;
    const accounts = await provider.request({ method: "eth_accounts" });
    if (!accounts?.length) return "no_accounts";
    const pc = createPublicClient({ chain: celo, transport: http() });
    const bal = await readBalance(pc, accounts[0] as `0x${string}`);
    return bal >= BigInt(warsAtomic(amount)) ? "enough" : "insufficient";
  } catch {
    return "error";
  }
}

async function ensureCelo(provider: EIP1193Provider) {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId === `0x${celo.id.toString(16)}`) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${celo.id.toString(16)}` }] });
  } catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: `0x${celo.id.toString(16)}`, chainName: "Celo", rpcUrls: ["https://forno.celo.org"], nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 }, blockExplorerUrls: ["https://celoscan.io"] }],
    });
  }
}

export async function payWithWars(ethereum: unknown, vault: string, amount: number, sale: string | null): Promise<PayOutcome> {
  if (!hasWallet(ethereum)) return { ok: false, reason: GENERIC };
  try {
    const provider = ethereum as EIP1193Provider;
    const walletClient = createWalletClient({ chain: celo, transport: custom(provider) });
    const [account] = await walletClient.requestAddresses();
    await ensureCelo(provider);
    const publicClient = createPublicClient({ chain: celo, transport: http() });
    const atomic = BigInt(warsAtomic(amount));
    if ((await readBalance(publicClient, account)) < atomic) return { ok: false, reason: NO_BALANCE };

    const signer = toClientEvmSigner(
      { address: account, signTypedData: (m) => walletClient.signTypedData({ account, ...m } as Parameters<typeof walletClient.signTypedData>[0]) },
      publicClient,
    );
    const client = new x402Client();
    client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: WARS, maxAmountPerPayment: atomic.toString() }] });
    client.register("eip155:*", new ExactEvmScheme(signer));

    // el cliente firma un permit EIP-2612 que sponsorea el facilitador: no paga gas
    const res = await wrapFetchWithPayment(fetch, client)(payUrl(vault, amount, sale));
    const body = (await res.json().catch(() => ({}))) as { txHash?: string; error?: string };
    if (!res.ok) return { ok: false, reason: mapPayError(new Error(body.error ?? `HTTP ${res.status}`)) };
    return body.txHash ? { ok: true, txHash: body.txHash } : { ok: false, reason: GENERIC };
  } catch (e) {
    return { ok: false, reason: mapPayError(e) };
  }
}
