import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { getAddress, isAddress, parseUnits } from "viem";
import { NETWORK, WARS } from "./wars.ts";

export type X402Result =
  | { status: "paid"; txHash: string; payer?: string }
  | { status: "rejected"; reason: string };

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

export function facilitatorFromEnv(env: Record<string, string | undefined> = process.env): FacilitatorClient | null {
  const key = env.X402_API_KEY;
  if (!key) return null;
  const headers = { "X-API-Key": key };
  return new HTTPFacilitatorClient({
    url: env.X402_FACILITATOR_URL || FACILITATOR_URL,
    createAuthHeaders: async () => ({ verify: headers, settle: headers, supported: headers }),
  });
}

export async function buildRequirements(server: x402ResourceServer, vault: string, amount: number): Promise<PaymentRequirements> {
  if (!isAddress(vault)) throw new Error("Vault inválido");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido");
  await server.initialize();
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

export async function requirementsFor(vault: string, amount: number, facilitator = facilitatorFromEnv()) {
  if (!facilitator) throw new Error("Falta X402_API_KEY");
  return buildRequirements(makeServer(facilitator), vault, amount);
}

export async function payWithX402(
  vault: string,
  amount: number,
  payment: PaymentPayload,
  facilitator: FacilitatorClient | null = facilitatorFromEnv(),
  env: Record<string, string | undefined> = process.env,
): Promise<X402Result> {
  const unavailable = x402Unavailable(env);
  if (unavailable) return { status: "rejected", reason: unavailable };
  if (!facilitator) return { status: "rejected", reason: "Falta X402_API_KEY: el cobro con x402 no está habilitado" };
  let settling = false;
  try {
    const server = makeServer(facilitator);
    const req = await buildRequirements(server, vault, amount);
    if (!server.findMatchingRequirements([req], payment)) return { status: "rejected", reason: "El pago no coincide con el monto o el comercio" };
    const verified = await server.verifyPayment(payment, req);
    if (!verified.isValid) return { status: "rejected", reason: `Pago inválido: ${verified.invalidReason ?? "sin detalle"}` };
    settling = true;
    const settled = await server.settlePayment(payment, req);
    if (!settled.success || !settled.transaction) return { status: "rejected", reason: `El facilitador no liquidó: ${settled.errorReason ?? "sin detalle"}` };
    return { status: "paid", txHash: settled.transaction, payer: settled.payer };
  } catch (e) {
    console.error("payWithX402 falló", e);
    const msg = e instanceof Error ? e.message : String(e);
    // un error durante settle es indeterminado: la plata pudo haberse movido, no reintentar sin verificar onchain
    return { status: "rejected", reason: settling ? `No pudimos confirmar la liquidación (verificá onchain antes de reintentar): ${msg}` : `Error con el facilitador: ${msg}` };
  }
}
