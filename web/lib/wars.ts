import { getAddress, parseUnits } from "viem";

export const NETWORK = "eip155:42220";
export const WARS = getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D");

export const REJECTED = "Rechazaste la firma";
export const NO_BALANCE = "No te alcanza el saldo";
export const UNCONFIRMED = "No pudimos confirmar el cobro. Si se te descontó plata, avisale al comercio.";
export const GENERIC = "No pudimos cobrar, no se te debitó nada";
export const PESOS_NOTE = "Pagás en pesos, sin wallet ni gas.";

// Cada liquidación x402 nos cobra gas al facilitador: debajo del mínimo solo va "Pagar con pesos".
export const X402_MIN = 100;

// Códigos estables de /api/pay: el cliente nunca ve el texto crudo del facilitador.
export type PayCode = "invalid" | "not_settled" | "indeterminate" | "facilitator_error" | "unavailable";
export const PAY_MSG: Record<PayCode, string> = {
  invalid: "El pago no coincide con el monto o el comercio",
  not_settled: GENERIC,
  indeterminate: UNCONFIRMED,
  facilitator_error: GENERIC,
  unavailable: "El cobro con wARS no está habilitado ahora",
};

export type WalletCheck = "enough" | "insufficient" | "no_wallet" | "no_accounts" | "error";
export type PayOption = "wars" | "pesos";

export function hasWallet(ethereum: unknown): boolean {
  return typeof ethereum === "object" && ethereum !== null && typeof (ethereum as { request?: unknown }).request === "function";
}

export function choosePayOption(check: WalletCheck): PayOption {
  // sin cuenta conectada todavía: se muestra el botón y se verifica al pagar
  return check === "enough" || check === "no_accounts" ? "wars" : "pesos";
}

export function mapPayError(e: unknown): string {
  if (typeof e === "string") {
    if (Object.hasOwn(PAY_MSG, e)) return PAY_MSG[e as PayCode];
    // códigos de máquina ajenos (p. ej. insufficient_credits del facilitador) no se traducen por regex
    if (/^[a-z_]+$/.test(e)) return GENERIC;
  }
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/user.?reject|denied|4001/i.test(msg)) return REJECTED;
  if (/insufficient|saldo|exceed|not enough|no te alcanza/i.test(msg)) return NO_BALANCE;
  if (/verific|onchain|indeterminad|confirm/i.test(msg)) return UNCONFIRMED;
  return GENERIC;
}

export function warsAtomic(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido");
  return parseUnits(amount.toFixed(2), 18).toString();
}
