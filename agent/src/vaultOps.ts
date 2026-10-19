import { keccak256, stringToHex, type Address, type Hex } from "viem";

import { vaultAbi } from "./chainVault.ts";
import { formatPesos } from "./money.ts";

export type OpsReader = {
  readContract(args: any): Promise<any>;
  simulateContract(args: any): Promise<{ request: any }>;
  waitForTransactionReceipt(args: any): Promise<{ status: string }>;
};
export type OpsWallet = { account: { address: Address }; writeContract(args: any): Promise<Hex> };

export type OpRecord = {
  id: string;
  opId: Hex;
  accion: "apartar" | "retirar" | "dolarizar";
  monto: bigint;
  destino: string;
  resultado: "ejecutada" | "ya_ejecutada" | "rechazada" | "error";
  txHash?: Hex;
  error?: string;
  /** Why nothing was sent (resultado "rechazada"), written for the owner. */
  mensaje?: string;
  at: number;
};

export const BUCKETS = { ahorro: 1, impuestos: 2 } as const;
export type BucketName = keyof typeof BUCKETS;
export const SWAP_BUCKETS = { operativo: 0, ahorro: 1, impuestos: 2 } as const;
export type SwapBucket = keyof typeof SWAP_BUCKETS;

/** Textile FX as TildaiVault.swap needs it; injected so tests never touch the API. */
export type Fx = {
  cotizar(monto: bigint): Promise<{ status: string; reason?: string; buyAmount: bigint }>;
  cotizarFirme(p: { monto: bigint; vaultAddress: Address; maxRate: bigint; previewRate: bigint }): Promise<{ spender: Address; target: Address; data: Hex; amountIn: bigint; minOut: bigint; expiresAt: number }>;
};

type Plan = {
  destino: string;
  fn?: string;
  args?: unknown[];
  monto?: bigint;
  rechazo?: string;
  /** Runs right before the tx is sent; a string aborts with that message. */
  ultimoChequeo?: () => string | undefined;
};

const MIN_SWAP_SECONDS = 5; // a firm quote must still live this long when the tx goes out

export const opIdOf = (id: string): Hex => keccak256(stringToHex(id));

export class VaultOps {
  records: OpRecord[] = [];
  private cfg: { vault: Address; wallet: OpsWallet; reader: OpsReader; feeCurrency?: Address; now: () => number; onRecord: (r: OpRecord) => void; notify: (msg: string) => void };

  // shortcut: records live in memory and go to the log; persist them (and push `notify` to Telegram) when the agent has a store.
  constructor(c: { vault: Address; wallet: OpsWallet; reader: OpsReader; feeCurrency?: Address; now?: () => number; onRecord?: (r: OpRecord) => void; notify?: (msg: string) => void }) {
    this.cfg = {
      vault: c.vault,
      wallet: c.wallet,
      reader: c.reader,
      feeCurrency: c.feeCurrency,
      now: c.now ?? Date.now,
      onRecord: c.onRecord ?? ((r) => console.log("[tildai] op", r.id, r.accion, r.resultado, r.txHash ?? r.error ?? "")),
      notify: c.notify ?? ((m) => console.error("[tildai] ALERTA", m)),
    };
  }

  apartar(id: string, bucket: BucketName, amount: bigint) {
    return this.run(id, "apartar", amount, async () => ({ destino: bucket, fn: "allocate", args: [BUCKETS[bucket], amount] }));
  }

  retirar(id: string, amount: bigint) {
    return this.run(id, "retirar", amount, async () => ({
      destino: (await this.cfg.reader.readContract({ address: this.cfg.vault, abi: vaultAbi, functionName: "payoutWallet" })) as string,
      fn: "withdraw",
      args: [amount],
    }));
  }

  dolarizar(id: string, bucket: SwapBucket, wars: bigint, fx: Fx) {
    return this.run(id, "dolarizar", wars, (used) => this.planDolarizar(used, bucket, wars, fx));
  }

  private async planDolarizar(used: boolean, bucket: SwapBucket, wars: bigint, fx: Fx): Promise<Plan> {
    const destino = `USD₮ (desde ${bucket})`;
    if (used) return { destino };
    const { vault, reader } = this.cfg;
    const rechazo = (mensaje: string): Plan => ({ destino, rechazo: mensaje });
    const [paused, maxRate, maxSwap, canSavings, canTaxes, operating, savings, taxes] = await Promise.all(
      ["paused", "maxRate", "maxSwap", "canSwapSavings", "canSwapTaxes", "operating", "savings", "taxes"].map((functionName) => reader.readContract({ address: vault, abi: vaultAbi, functionName })),
    );
    if (paused) return rechazo("El vault está pausado: no dolarizo nada hasta que el dueño lo reactive.");
    if ((bucket === "ahorro" && !canSavings) || (bucket === "impuestos" && !canTaxes)) {
      return rechazo(`No puedo dolarizar el ${bucket}: el permiso lo habilita solo el dueño, desde su wallet. Es opcional y tiene riesgo: al pasar el ${bucket} a USD₮, hoy casi no hay quien compre USD₮ para volver a pesos y el valor en pesos puede variar. Si el dueño acepta ese riesgo, lo habilita y recién ahí puedo hacerlo.`);
    }
    if (wars > { operativo: operating, ahorro: savings, impuestos: taxes }[bucket]) return rechazo(`No alcanza: el ${bucket} no tiene ${formatPesos(wars)}.`);
    if (wars > maxSwap) return rechazo(`El monto supera el tope por operación del vault (${formatPesos(maxSwap)}).`);

    const preview = await fx.cotizar(wars);
    if (preview.status !== "preview" || preview.buyAmount <= 0n) return rechazo(`Textile no tiene cotización ahora${preview.reason ? ` (${preview.reason})` : ""}. No dolaricé nada.`);
    const previewRate = (wars * 10n ** 6n) / preview.buyAmount; // wARS (wei) per whole USD₮, same unit as maxRate
    const caro = (rate: bigint) =>
      rechazo(`La cotización (${formatPesos(rate)} por USD₮) supera el precio máximo del vault (${formatPesos(maxRate)}), así que no dolaricé. Si querés, el precio máximo se puede subir, pero eso lo firma el dueño desde su wallet: yo no puedo cambiarlo.`);
    if (previewRate > maxRate) return caro(previewRate);

    let swap;
    try {
      swap = await fx.cotizarFirme({ monto: wars, vaultAddress: vault, maxRate, previewRate });
    } catch (err) {
      if (/maxRate/.test((err as Error).message)) return caro(previewRate);
      throw err;
    }
    return {
      destino,
      monto: swap.amountIn,
      fn: "swap",
      args: [SWAP_BUCKETS[bucket], swap.spender, swap.target, swap.data, swap.amountIn, swap.minOut],
      ultimoChequeo: () => (swap.expiresAt * 1000 - this.cfg.now() < MIN_SWAP_SECONDS * 1000 ? "La cotización venció antes de enviarla: no dolaricé nada. Pedila de nuevo." : undefined),
    };
  }

  /** Reads usedOp first, simulates, then sends. Never throws: every outcome is recorded, and errors also notify. */
  private async run(id: string, accion: OpRecord["accion"], monto: bigint, plan: (used: boolean) => Promise<Plan>): Promise<OpRecord> {
    const opId = opIdOf(id);
    const rec: OpRecord = { id, opId, accion, monto, destino: "?", resultado: "error", at: Date.now() };
    const { vault, wallet, reader, feeCurrency } = this.cfg;
    try {
      if (monto <= 0n) throw new Error("el monto tiene que ser mayor a 0");
      const used = (await reader.readContract({ address: vault, abi: vaultAbi, functionName: "usedOp", args: [opId] })) as boolean;
      const p = await plan(used);
      rec.destino = p.destino;
      if (p.monto) rec.monto = p.monto;
      if (used) {
        rec.resultado = "ya_ejecutada";
        return this.finish(rec);
      }
      if (p.rechazo) {
        rec.resultado = "rechazada";
        rec.mensaje = p.rechazo;
        return this.finish(rec);
      }
      const { request } = await reader.simulateContract({ account: wallet.account, address: vault, abi: vaultAbi, functionName: p.fn, args: [opId, ...p.args!] });
      const tarde = p.ultimoChequeo?.();
      if (tarde) {
        rec.resultado = "rechazada";
        rec.mensaje = tarde;
        return this.finish(rec);
      }
      rec.txHash = await wallet.writeContract(feeCurrency ? { ...request, feeCurrency } : request);
      const receipt = await reader.waitForTransactionReceipt({ hash: rec.txHash });
      if (receipt.status !== "success") throw new Error(`la tx ${rec.txHash} se revirtió`);
      rec.resultado = "ejecutada";
    } catch (err) {
      rec.resultado = "error";
      rec.error = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
      // With a txHash but no receipt the state is unknown: retrying is safe because usedOp is checked first.
    }
    return this.finish(rec);
  }

  private finish(rec: OpRecord) {
    this.records.push(rec);
    this.cfg.onRecord(rec);
    if (rec.resultado === "error") {
      this.cfg.notify(`${rec.accion} ${formatPesos(rec.monto)} (${rec.id}) falló: ${rec.error}${rec.txHash ? ` [tx ${rec.txHash}]` : ""}`);
    }
    return rec;
  }
}
