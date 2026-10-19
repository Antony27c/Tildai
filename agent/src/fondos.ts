import { formatPesos, pesosToWei } from "./money.ts";
import type { BucketName, Fx, OpRecord, SwapBucket, VaultOps } from "./vaultOps.ts";

// Argentine day, same cut as the vault (UTC-3).
const fechaART = (now: number) => new Date(now - 3 * 3_600_000).toISOString().slice(0, 10);

const view = (r: OpRecord) => ({ id: r.id, resultado: r.resultado, monto: formatPesos(r.monto), destino: r.destino, txHash: r.txHash, error: r.error, mensaje: r.mensaje });

/** Default id dedupes the same action, bucket and amount on the same day; pass idOperacion to repeat it on purpose. */
export async function apartar(ops: VaultOps, input: { bucket: BucketName; monto: number; idOperacion?: string }, now = Date.now()) {
  const wei = pesosToWei(input.monto);
  return view(await ops.apartar(input.idOperacion ?? `apartar:${fechaART(now)}:${input.bucket}:${wei}`, input.bucket, wei));
}

export async function retirar(ops: VaultOps, input: { monto: number; idOperacion?: string }, rampChainId: number, now = Date.now()) {
  const wei = pesosToWei(input.monto);
  const r = await ops.retirar(input.idOperacion ?? `retirar:${fechaART(now)}:${wei}`, wei);
  const ok = r.resultado !== "error";
  return {
    ...view(r),
    linkOffRamp: ok ? `https://ramp.ripio.com/offramp?country=AR&chain=${rampChainId}&token=WARS&amount=${input.monto}&address=${r.destino}` : undefined,
  };
}

/** Default id dedupes the same bucket and amount on the same day; pass idOperacion to repeat it on purpose. */
export async function dolarizar(ops: VaultOps, fx: Fx, input: { bucket: SwapBucket; monto: number; idOperacion?: string }, now = Date.now()) {
  const wei = pesosToWei(input.monto);
  return view(await ops.dolarizar(input.idOperacion ?? `dolarizar:${fechaART(now)}:${input.bucket}:${wei}`, input.bucket, wei, fx));
}
