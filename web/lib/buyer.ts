import { createPublicClient, createWalletClient, custom, http, parseAbi, type EIP1193Provider } from "viem";
import { celo } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { payUrl } from "./sale.ts";
import { GENERIC, hasWallet, mapPayError, NETWORK, NO_BALANCE, WARS, warsAtomic, type WalletCheck } from "./wars.ts";

export type PayOutcome = { ok: true; txHash?: string; pending?: true } | { ok: false; reason: string };
type Reader = { readContract: (args: any) => Promise<bigint> };

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const celoReader = () => createPublicClient({ chain: celo, transport: http() }) as unknown as Reader;

// shortcut: MiniPay no soporta message signing y el cobro x402 firma un permit Permit2 con
// eth_signTypedData_v4, así que dentro de MiniPay solo queda "Pagar con pesos".
// https://raw.githubusercontent.com/celo-org/agent-skills/main/skills/minipay-integration/SKILL.md ("Not Supported: Message signing")
export function isMiniPay(ethereum: unknown): boolean {
  return typeof ethereum === "object" && ethereum !== null && (ethereum as { isMiniPay?: unknown }).isMiniPay === true;
}

export async function checkWarsWallet(ethereum: unknown, amount?: number, pc: Reader = celoReader()): Promise<WalletCheck> {
  if (!hasWallet(ethereum) || isMiniPay(ethereum)) return "no_wallet";
  try {
    const accounts = await (ethereum as EIP1193Provider).request({ method: "eth_accounts" });
    if (!accounts?.length) return "no_accounts";
    if (amount === undefined) return "enough";
    const bal = await pc.readContract({ address: WARS, abi: erc20, functionName: "balanceOf", args: [accounts[0]] });
    return bal >= BigInt(warsAtomic(amount)) ? "enough" : "insufficient";
  } catch {
    return "error";
  }
}

async function ensureCelo(provider: EIP1193Provider) {
  const hex = `0x${celo.id.toString(16)}`;
  if ((await provider.request({ method: "eth_chainId" })) === hex) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: "Celo", rpcUrls: ["https://forno.celo.org"], nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 }, blockExplorerUrls: ["https://celoscan.io"] }],
    });
  }
}

// Solo se reintenta un pago que el servidor rechazó como "invalid" (p. ej. carrera de nonce del permit).
// Con otro código —y sobre todo "indeterminate"— la plata pudo haberse movido: NO reintentar.
export function retriable(status: number, code?: string): boolean {
  return status === 402 && code === "invalid";
}

export function readPayResponse(status: number, body: { txHash?: string; error?: string; code?: string }): PayOutcome {
  if (status !== 200) return { ok: false, reason: mapPayError(body.code ?? new Error(body.error ?? `HTTP ${status}`)) };
  // 200 sin txHash: la liquidación pudo ocurrir igual; jamás decir "no se te debitó nada"
  return body.txHash ? { ok: true, txHash: body.txHash } : { ok: true, pending: true };
}

export async function payWithWars(
  ethereum: unknown,
  vault: string,
  amount: number,
  sale: string | null,
  deps: { payFetch?: (url: string) => Promise<{ status: number; json: () => Promise<any> }> } = {},
): Promise<PayOutcome> {
  if (!hasWallet(ethereum) || isMiniPay(ethereum)) return { ok: false, reason: GENERIC };
  try {
    const provider = ethereum as EIP1193Provider;
    const walletClient = createWalletClient({ chain: celo, transport: custom(provider) });
    const [account] = await walletClient.requestAddresses();
    await ensureCelo(provider);
    const atomic = BigInt(warsAtomic(amount));
    if ((await readBalance(account, atomic))) return { ok: false, reason: NO_BALANCE };

    let payFetch = deps.payFetch;
    if (!payFetch) {
      const signer = toClientEvmSigner(
        { address: account, signTypedData: (m) => walletClient.signTypedData({ account, ...m } as Parameters<typeof walletClient.signTypedData>[0]) },
        celoReader() as any,
      );
      const client = new x402Client();
      client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: WARS, maxAmountPerPayment: atomic.toString() }] });
      client.register("eip155:*", new ExactEvmScheme(signer));
      // el cliente firma un permit EIP-2612 que sponsorea el facilitador: no paga gas
      payFetch = (url) => wrapFetchWithPayment(fetch, client)(url);
    }

    let res = await payFetch(payUrl(vault, amount, sale));
    let body = (await res.json().catch(() => ({}))) as { txHash?: string; error?: string; code?: string };
    if (retriable(res.status, body.code)) {
      res = await payFetch(payUrl(vault, amount, sale));
      body = (await res.json().catch(() => ({}))) as { txHash?: string; error?: string; code?: string };
    }
    return readPayResponse(res.status, body);
  } catch (e) {
    return { ok: false, reason: mapPayError(e) };
  }

  async function readBalance(account: `0x${string}`, atomic: bigint): Promise<boolean> {
    const bal = await celoReader().readContract({ address: WARS, abi: erc20, functionName: "balanceOf", args: [account] });
    return bal < atomic;
  }
}
