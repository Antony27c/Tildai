import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { checkSalePending, reportPayment, type SaleCheck } from "../../../lib/indexer.ts";
import { parseAmount } from "../../../lib/ripio.ts";
import { checkVault } from "../../../lib/vaults.ts";
import { parseSale, settledBody } from "../../../lib/sale.ts";
import { rateLimit } from "../../../lib/ratelimit.ts";
import { PAY_MSG, warsAtomic, X402_MIN } from "../../../lib/wars.ts";
import { facilitatorFromEnv, GAS_SPONSORING, payWithX402, requirementsFor, x402Unavailable } from "../../../lib/x402.ts";

const json = (body: unknown, status: number, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

// Los GET sin firma con ?sale= no tocan al facilitador pero sí al indexer: la validación se cachea
// unos segundos para que un flood no se amplifique. El pago firmado siempre valida fresco.
const SALE_CHECK_TTL_MS = 5_000;
const saleChecks = new Map<string, { r: SaleCheck; t: number }>();
async function saleCheck(saleId: string, vault: string, atomic: string, cached: boolean): Promise<SaleCheck> {
  const key = `${saleId}:${vault.toLowerCase()}:${atomic}`;
  const hit = cached ? saleChecks.get(key) : undefined;
  if (hit && Date.now() - hit.t < SALE_CHECK_TTL_MS) return hit.r;
  const r = await checkSalePending(saleId, vault, atomic);
  // "conflict" no se cachea: un rechazo viejo puede volverse falso al instante (venta recién creada)
  if (cached && r !== "conflict") {
    if (saleChecks.size > 1000) for (const [k, v] of saleChecks) if (Date.now() - v.t > SALE_CHECK_TTL_MS) saleChecks.delete(k);
    saleChecks.set(key, { r, t: Date.now() });
  }
  return r;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vault = url.searchParams.get("vault") ?? undefined;
  const amount = parseAmount(url.searchParams.get("amount") ?? undefined);
  if (!amount) return json({ error: "Monto inválido" }, 400);
  if (amount < X402_MIN) return json({ error: `El mínimo para pagar con wARS es $ ${X402_MIN}` }, 400);
  const sale = parseSale(url.searchParams.get("sale"));
  if (!sale.ok) return json({ error: "Venta inválida" }, 400);

  const signature = request.headers.get("PAYMENT-SIGNATURE");
  // El pedido sin firma no toca al facilitador (isVault va cacheado y la venta por saleCheck): limitarlo
  // por vault dejaba el 402 del comercio a merced de cualquiera con varias IPs. Solo se limita por IP.
  // Firmado: 5/min por IP y 20/min por vault (cada settle igual pasa por verify).
  // shortcut: x-forwarded-for solo confiable en Vercel; detrás de otro proxy que agregue en vez de pisar, el cliente elige el primer valor
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
  if (signature) {
    if (!rateLimit(`s:ip:${ip}`, 5) || !rateLimit(`s:vault:${vault?.toLowerCase() ?? "sin-vault"}`, 20)) {
      return json({ error: "Demasiados pedidos, probá en un minuto" }, 429);
    }
  } else if (!rateLimit(`u:ip:${ip}`, 30)) {
    return json({ error: "Demasiados pedidos, probá en un minuto" }, 429);
  }

  const unavailable = x402Unavailable();
  if (unavailable) return json({ error: unavailable }, 503);
  const check = await checkVault(vault);
  if (check.status === "invalid") return json({ error: "Link de cobro inválido" }, 400);
  if (check.status === "error" || !vault) return json({ error: "No pudimos verificar el comercio" }, 503);

  // con venta: antes de armar el 402 o liquidar, la venta tiene que existir y coincidir
  if (sale.sale) {
    const chk = await saleCheck(sale.sale, vault, warsAtomic(amount), !signature);
    if (chk === "conflict") return json({ error: "Esa venta no existe, ya no está pendiente o no coincide con el link" }, 409);
    if (chk === "unavailable") return json({ error: "No pudimos verificar la venta, probá en un minuto" }, 503);
  }

  const facilitator = facilitatorFromEnv();
  if (!facilitator) return json({ error: PAY_MSG.unavailable }, 503);

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
  if (result.status === "rejected") return json({ error: PAY_MSG[result.code], code: result.code }, 402);
  const aviso = await reportPayment(sale.sale, result.txHash);
  return json({ ...settledBody(sale.sale, result.txHash, vault, amount), ...(aviso && { aviso }) }, 200, {
    "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: result.txHash, network: "eip155:42220", payer: result.payer }),
  });
}
