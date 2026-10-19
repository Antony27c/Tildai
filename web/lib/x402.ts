export type X402Result =
  | { status: "paid"; txHash: `0x${string}` }
  | { status: "rejected"; reason: string };

// shortcut: no habla con el facilitador; conectar a https://api.x402.celo.org (Permit2, wARS) cuando se pruebe en serio.
export async function payWithX402(_vault: string, _amount: number): Promise<X402Result> {
  return { status: "rejected", reason: "x402 no implementado" };
}
