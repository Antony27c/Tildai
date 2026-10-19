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
  accion: "apartar" | "retirar";
  monto: bigint;
  destino: string;
  resultado: "ejecutada" | "ya_ejecutada" | "error";
  txHash?: Hex;
  error?: string;
  at: number;
};

export const BUCKETS = { ahorro: 1, impuestos: 2 } as const;
export type BucketName = keyof typeof BUCKETS;

export const opIdOf = (id: string): Hex => keccak256(stringToHex(id));

export class VaultOps {
  records: OpRecord[] = [];
  private cfg: { vault: Address; wallet: OpsWallet; reader: OpsReader; onRecord: (r: OpRecord) => void; notify: (msg: string) => void };

  // shortcut: records live in memory and go to the log; persist them (and push `notify` to Telegram) when the agent has a store.
  constructor(c: { vault: Address; wallet: OpsWallet; reader: OpsReader; onRecord?: (r: OpRecord) => void; notify?: (msg: string) => void }) {
    this.cfg = {
      vault: c.vault,
      wallet: c.wallet,
      reader: c.reader,
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

  /** Reads usedOp first, simulates, then sends. Never throws: every outcome is recorded, and errors also notify. */
  private async run(id: string, accion: OpRecord["accion"], monto: bigint, plan: () => Promise<{ destino: string; fn: string; args: unknown[] }>): Promise<OpRecord> {
    const opId = opIdOf(id);
    const rec: OpRecord = { id, opId, accion, monto, destino: "?", resultado: "error", at: Date.now() };
    const { vault, wallet, reader } = this.cfg;
    try {
      if (monto <= 0n) throw new Error("el monto tiene que ser mayor a 0");
      const p = await plan();
      rec.destino = p.destino;
      if (await reader.readContract({ address: vault, abi: vaultAbi, functionName: "usedOp", args: [opId] })) {
        rec.resultado = "ya_ejecutada";
        return this.finish(rec);
      }
      const { request } = await reader.simulateContract({ account: wallet.account, address: vault, abi: vaultAbi, functionName: p.fn, args: [opId, ...p.args] });
      rec.txHash = await wallet.writeContract(request);
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
