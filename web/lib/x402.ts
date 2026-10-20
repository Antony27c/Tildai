import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { getAddress, isAddress, parseUnits } from "viem";
import { NETWORK, WARS, type PayCode } from "./wars.ts";

export type X402Result =
  | { status: "paid"; txHash: string; payer?: string }
  | { status: "rejected"; code: PayCode };

export { NETWORK, WARS };
export const FACILITATOR_URL = "https://api.x402.celo.org";
export const GAS_SPONSORING = {
  eip2612GasSponsoring: { info: { description: "The facilitator sponsors the EIP-2612 permit to Permit2.", version: "1" } },
};

export function x402Unavailable(env: Record<string, string | undefined> = process.env): string | null {
  return env.TILDAI_CHAIN_ID === "42220" ? null : "x402 solo cobra en Celo mainnet (TILDAI_CHAIN_ID=42220): este vault no es de mainnet";
}

function makeServer(facilitator: FacilitatorClient) {
  return new x402ResourceServer(facilitator).register("eip155:*", new ExactEvmScheme());
}

// El facilitador y el servidor se crean una sola vez por proceso: initialize() es un GET /supported con nuestra key.
let envFacilitator: FacilitatorClient | null | undefined;
const servers = new WeakMap<FacilitatorClient, Promise<x402ResourceServer>>();

function sharedServer(facilitator: FacilitatorClient): Promise<x402ResourceServer> {
  let p = servers.get(facilitator);
  if (!p) {
    const s = makeServer(facilitator);
    p = s.initialize().then(
      () => s,
      (e) => {
        servers.delete(facilitator);
        throw e;
      },
    );
    servers.set(facilitator, p);
  }
  return p;
}

function buildClient(env: Record<string, string | undefined>): FacilitatorClient | null {
  const key = env.X402_API_KEY;
  if (!key) return null;
  const headers = { "X-API-Key": key };
  return new HTTPFacilitatorClient({
    url: FACILITATOR_URL,
    createAuthHeaders: async () => ({ verify: headers, settle: headers, supported: headers }),
  });
}

export function facilitatorFromEnv(env: Record<string, string | undefined> = process.env): FacilitatorClient | null {
  return env === process.env ? (envFacilitator ??= buildClient(env)) : buildClient(env);
}

async function requirementsFrom(server: x402ResourceServer, vault: string, amount: number): Promise<PaymentRequirements> {
  if (!isAddress(vault)) throw new Error("Vault inválido");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido");
  const [req] = await server.buildPaymentRequirementsFromOptions(
    [
      {
        scheme: "exact",
        network: NETWORK,
        payTo: getAddress(vault),
        price: {
          amount: parseUnits(amount.toFixed(2), 18).toString(),
          asset: WARS,
          extra: { name: "Peso Argentino", version: "1", assetTransferMethod: "permit2" },
        },
      },
    ],
    undefined,
  );
  return req;
}

export async function buildRequirements(server: x402ResourceServer, vault: string, amount: number): Promise<PaymentRequirements> {
  await server.initialize();
  return requirementsFrom(server, vault, amount);
}

export async function requirementsFor(vault: string, amount: number, facilitator = facilitatorFromEnv()) {
  if (!facilitator) throw new Error("Falta X402_API_KEY");
  return requirementsFrom(await sharedServer(facilitator), vault, amount);
}

export async function payWithX402(
  vault: string,
  amount: number,
  payment: PaymentPayload,
  facilitator: FacilitatorClient | null = facilitatorFromEnv(),
  env: Record<string, string | undefined> = process.env,
): Promise<X402Result> {
  if (x402Unavailable(env) || !facilitator) return { status: "rejected", code: "unavailable" };
  if (!isAddress(vault) || !Number.isFinite(amount) || amount <= 0) return { status: "rejected", code: "invalid" };
  let settling = false;
  try {
    const server = await sharedServer(facilitator);
    const req = await requirementsFrom(server, vault, amount);
    if (!server.findMatchingRequirements([req], payment)) return { status: "rejected", code: "invalid" };
    const verified = await server.verifyPayment(payment, req);
    if (!verified.isValid) {
      console.error("x402 verify rechazó:", verified.invalidReason);
      return { status: "rejected", code: "invalid" };
    }
    settling = true;
    const settled = await server.settlePayment(payment, req);
    if (!settled.success || !settled.transaction) {
      console.error("x402 settle no liquidó:", settled.errorReason);
      return { status: "rejected", code: "not_settled" };
    }
    return { status: "paid", txHash: settled.transaction, payer: settled.payer };
  } catch (e) {
    console.error("payWithX402 falló", e);
    // un error durante settle es indeterminado: la plata pudo haberse movido, no reintentar sin verificar onchain
    return { status: "rejected", code: settling ? "indeterminate" : "facilitator_error" };
  }
}
