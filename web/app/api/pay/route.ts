import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { parseAmount } from "../../../lib/ripio.ts";
import { checkVault } from "../../../lib/vaults.ts";
import { facilitatorFromEnv, GAS_SPONSORING, payWithX402, requirementsFor } from "../../../lib/x402.ts";

const json = (body: unknown, status: number, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vault = url.searchParams.get("vault") ?? undefined;
  const amount = parseAmount(url.searchParams.get("amount") ?? undefined);
  if (!amount) return json({ error: "Monto inválido" }, 400);
  const check = await checkVault(vault);
  if (check.status === "invalid") return json({ error: "Link de cobro inválido" }, 400);
  if (check.status === "error" || !vault) return json({ error: "No pudimos verificar el comercio" }, 503);
  const facilitator = facilitatorFromEnv();
  if (!facilitator) return json({ error: "El cobro con x402 no está habilitado" }, 503);

  const signature = request.headers.get("PAYMENT-SIGNATURE");
  if (!signature) {
    try {
      const accepts = [await requirementsFor(vault, amount, facilitator)];
      const required = { x402Version: 2, resource: { url: request.url }, accepts, extensions: GAS_SPONSORING };
      return json(required, 402, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) });
    } catch (e) {
      console.error("armado del requerimiento x402 falló", e);
      return json({ error: "No pudimos armar el cobro" }, 503);
    }
  }
  let payment;
  try {
    payment = decodePaymentSignatureHeader(signature);
  } catch {
    return json({ error: "PAYMENT-SIGNATURE ilegible" }, 400);
  }
  const result = await payWithX402(vault, amount, payment, facilitator);
  if (result.status === "rejected") return json({ error: result.reason }, 402);
  return json(result, 200, {
    "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: result.txHash, network: "eip155:42220", payer: result.payer }),
  });
}
