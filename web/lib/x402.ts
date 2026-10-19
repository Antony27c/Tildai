export type X402Result =
  | { status: "paid"; txHash: `0x${string}` }
  | { status: "rejected"; reason: string };

// shortcut: respuesta simulada, no habla con el facilitador; conectar a https://api.x402.celo.org (Permit2, wARS) cuando se pruebe en serio.
export async function payWithX402(vault: string, amount: number): Promise<X402Result> {
  if (!(amount > 0)) return { status: "rejected", reason: "Monto inválido" };
  return { status: "paid", txHash: `0x${"0".repeat(64)}` };
}
