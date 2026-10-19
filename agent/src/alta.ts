import { mkdirSync, readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { isAddress, parseEventLogs, type Address, type Hex } from "viem";

import { factoryAbi, type ChainReader } from "./chainVault.ts";
import { formatPesos } from "./money.ts";
import { dayIndex } from "./sales.ts";
import type { OpsReader, OpsWallet } from "./vaultOps.ts";

export const MAX_RATE = 1_700n * 10n ** 18n; // wARS (wei) por USD₮ entero
export const MAX_SWAP = 60_000n * 10n ** 18n;
export const SUGERIDO_TOPE = 100_000;

export type ChatEntry = {
  estado: "creado" | "enviada" | "error";
  owner: Address;
  dailyCap: string;
  vault?: Address;
  fromBlock?: string;
  txHash?: Hex;
  error?: string;
  at: number;
};

// shortcut: JSON local por proceso, compartido con nadie; si el agente corre en varios procesos, esto pasa a una base.
export class ChatVaultRegistry {
  private map = new Map<string, ChatEntry>();
  /** createVault txs sent per argentine day: survives restarts so the daily cap can't be bypassed. */
  private altas = { dia: -1, count: 0 };
  private file: string | undefined;

  private constructor(file: string | undefined) {
    this.file = file;
  }

  static load(file: string | undefined) {
    const r = new ChatVaultRegistry(file);
    if (file) {
      try {
        const d = JSON.parse(readFileSync(file, "utf8"));
        for (const [k, v] of Object.entries(d.chats ?? {})) r.map.set(k, v as ChatEntry);
        if (typeof d.altas?.dia === "number" && typeof d.altas?.count === "number") r.altas = d.altas;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`El archivo de comercios está corrupto (${file}): ${(e as Error).message}`);
      }
    }
    return r;
  }

  get(chatId: string) {
    return this.map.get(chatId);
  }

  /** Chats that already have a vault, for the daily close. */
  conVault(): { chatId: string; vault: Address; fromBlock: bigint }[] {
    return [...this.map]
      .filter(([, e]) => e.vault)
      .map(([chatId, e]) => ({ chatId, vault: e.vault as Address, fromBlock: e.fromBlock ? BigInt(e.fromBlock) : 0n }));
  }

  /** createVault txs sent today (Argentine day); the cap counts sends because each one spends gas. */
  altasDelDia(now = Date.now()): number {
    return this.altas.dia === dayIndex(now) ? this.altas.count : 0;
  }

  async set(chatId: string, e: ChatEntry, opts: { gastarAlta?: boolean; now?: number } = {}) {
    const now = opts.now ?? Date.now();
    if (opts.gastarAlta) this.altas = { dia: dayIndex(now), count: this.altasDelDia(now) + 1 };
    this.map.set(chatId, e);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      const f = await open(tmp, "w");
      try {
        await f.writeFile(JSON.stringify({ version: 1, altas: this.altas, chats: Object.fromEntries(this.map) }, null, 2), "utf8");
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(tmp, this.file);
    }
  }
}

/** Who may talk to the agent at all. Without TILDAI_OPEN_SIGNUP only allowlisted chats (TILDAI_ALLOWED_CHATS), the owner chat and chats that already have a registry entry get through: every alta spends agent gas, so the default is closed. */
export function chatHabilitado(
  chatId: string,
  registry: Pick<ChatVaultRegistry, "get">,
  env: { TILDAI_ALLOWED_CHATS?: string; TILDAI_OPEN_SIGNUP?: string; TILDAI_OWNER_CHAT_ID?: string },
): boolean {
  if (!chatId) return false;
  if (registry.get(chatId)) return true; // ya está de alta o con un alta en curso
  if (env.TILDAI_OPEN_SIGNUP === "1") return true;
  if (env.TILDAI_OWNER_CHAT_ID && chatId === env.TILDAI_OWNER_CHAT_ID) return true;
  return (env.TILDAI_ALLOWED_CHATS ?? "").split(",").map((s) => s.trim()).includes(chatId);
}

export type AltaResult =
  | { estado: "creado" | "ya_existente"; vault: Address; resumen: string }
  | { estado: "pendiente" | "error"; mensaje: string; txHash?: Hex };

type CreadorOpts = {
  registry: ChatVaultRegistry;
  factory: Address;
  fromBlock: bigint;
  reader: OpsReader & ChainReader;
  wallet: OpsWallet;
  feeCurrency?: Address;
  payBaseUrl: string;
  /** Max createVault txs per argentine day (env TILDAI_MAX_ALTAS_DIA). */
  maxAltasDia?: number;
  /** Minutes a sent tx may stay unmined before we check whether it was dropped (env TILDAI_ALTA_PENDIENTE_MIN). */
  pendienteMin?: number;
  now?: () => number;
};

export class CreadorVault {
  private o: Required<Omit<CreadorOpts, "feeCurrency">> & { feeCurrency?: Address };

  constructor(o: CreadorOpts) {
    const { maxAltasDia = 5, pendienteMin = 30, now = Date.now, ...rest } = o;
    this.o = { ...rest, maxAltasDia, pendienteMin, now };
  }

  /** The vault address always comes from the VaultCreated log: never from a simulated return value. */
  private vaultDelRecibo(logs: any[]): Address {
    const e = parseEventLogs({ abi: factoryAbi, eventName: "VaultCreated", logs })[0];
    const vault = e?.args?.vault;
    if (!vault) throw new Error("la tx confirmó pero no trajo el evento VaultCreated");
    return vault as Address;
  }

  /** Latest vault this factory created for the owner; used to recover after a tx was sent but not confirmed. */
  async findVaultByOwner(owner: Address): Promise<Address | null> {
    const latest = await this.o.reader.getBlockNumber();
    const logs: any[] = [];
    for (let a = this.o.fromBlock; a <= latest; a += 10_000n) {
      const b = a + 9_999n < latest ? a + 9_999n : latest;
      logs.push(...(await this.o.reader.getLogs({ address: this.o.factory, event: vaultCreatedEventArgs, args: { owner }, fromBlock: a, toBlock: b })));
    }
    return (logs.at(-1)?.args?.vault as Address | undefined) ?? null;
  }

  /**
   * Whether a sent tx can never mine anymore: the node no longer knows it (dropped/replaced) or a confirmed tx
   * already used its nonce. Throws on any read doubt, so the caller never sends a second createVault by mistake.
   */
  private async txDescartada(txHash: Hex): Promise<boolean> {
    const { reader, wallet } = this.o;
    if (!reader.getTransaction || !reader.getTransactionCount) throw new Error("el reader no puede inspeccionar la tx (faltan getTransaction/getTransactionCount)");
    let tx: { nonce?: number; blockNumber?: bigint | null } | null;
    try {
      tx = await reader.getTransaction({ hash: txHash });
    } catch (err) {
      if ((err as Error).name === "TransactionNotFoundError") return true;
      throw err;
    }
    if (!tx) return true;
    if (tx.blockNumber != null) throw new Error(`la tx ${txHash} figura minada pero no tiene recibo`);
    if (tx.nonce == null) throw new Error(`la tx ${txHash} vino sin nonce, no puedo comparar`);
    const confirmed = await reader.getTransactionCount({ address: wallet.account.address, blockTag: "latest" });
    return BigInt(confirmed) > BigInt(tx.nonce);
  }

  private locks = new Map<string, Promise<AltaResult>>();

  /** Two concurrent /start from the same chat share one in-flight creation, so they can never send two createVault. */
  crear(chatId: string, ownerRaw: string, capWei: bigint): Promise<AltaResult> {
    const running = this.locks.get(chatId);
    if (running) return running;
    const p = this.doCrear(chatId, ownerRaw, capWei).finally(() => this.locks.delete(chatId));
    this.locks.set(chatId, p);
    return p;
  }

  private async doCrear(chatId: string, ownerRaw: string, capWei: bigint): Promise<AltaResult> {
    const { registry, factory, reader, wallet, feeCurrency } = this.o;
    const prev = registry.get(chatId);
    if (prev?.vault) return { estado: "ya_existente", vault: prev.vault, resumen: this.resumen(prev.vault, BigInt(prev.dailyCap)) };
    if (!isAddress(ownerRaw)) return { estado: "error", mensaje: "Esa no es una wallet válida: tiene que ser una dirección 0x… de 42 caracteres. Pasámela de nuevo." };
    const owner = ownerRaw as Address;
    const base = { owner, dailyCap: capWei.toString(), at: this.o.now() };

    // If a previous tx went out without a confirmed result, check onchain before creating a second vault.
    if (prev?.txHash && !prev.vault) {
      const pendiente = { estado: "pendiente" as const, mensaje: "Tu caja todavía se está creando: la transacción está en la cadena pero sin confirmar. En un rato probá /start de nuevo y te confirmo.", txHash: prev.txHash };
      const duda = { estado: "error" as const, mensaje: "Ya mandé una transacción para tu caja y no pude verificar si quedó creada. Probá /start en un rato; no te voy a crear dos.", txHash: prev.txHash };
      let receipt: { status: string; logs?: any[] } | null = null;
      try {
        receipt = (await reader.getTransactionReceipt?.({ hash: prev.txHash })) ?? null;
      } catch (err) {
        if ((err as Error).name !== "TransactionReceiptNotFoundError") {
          console.error(`[tildai] ALERTA alta: no se pudo leer el recibo de ${prev.txHash} del chat ${chatId}`, err);
          return duda;
        }
      }
      if (receipt === null) {
        // An unmined tx can sit in the mempool or have been dropped/replaced. Past the timeout, find out which.
        if (this.o.now() - prev.at < this.o.pendienteMin * 60_000) return pendiente;
        let descartada: boolean;
        try {
          descartada = await this.txDescartada(prev.txHash);
        } catch (err) {
          console.error(`[tildai] ALERTA alta: no se pudo saber si la tx ${prev.txHash} del chat ${chatId} sigue viva`, err);
          return duda;
        }
        if (!descartada) return pendiente;
        // The tx can never land now; before failing the alta, sweep the factory logs anyway in case it did.
        try {
          const found = await this.findVaultByOwner((prev.owner ?? owner) as Address);
          if (found) {
            await registry.set(chatId, { ...base, estado: "creado", vault: found, txHash: prev.txHash });
            return { estado: "ya_existente", vault: found, resumen: this.resumen(found, capWei) };
          }
        } catch (err) {
          console.error(`[tildai] ALERTA alta: no se pudo verificar el vault anterior de ${chatId}, no creamos otro por las dudas`, err);
          return duda;
        }
        await registry.set(chatId, { ...base, estado: "error", error: `la tx ${prev.txHash} quedó descartada sin crear el vault` });
        return { estado: "error", mensaje: "La transacción para crear tu caja quedó descartada por la red y el vault no se creó (la verifiqué en la cadena). Probá /start de nuevo." };
      }
      try {
        // Search by the stored owner too: the first tx used it, a changed wallet doesn't matter for recovery.
        const found = receipt.status === "success" ? this.vaultDelRecibo(receipt.logs ?? []) : await this.findVaultByOwner((prev.owner ?? owner) as Address);
        if (found) {
          await registry.set(chatId, { ...base, estado: "creado", vault: found, fromBlock: String((receipt.logs ?? []).at(-1)?.blockNumber ?? ""), txHash: prev.txHash });
          return { estado: "ya_existente", vault: found, resumen: this.resumen(found, capWei) };
        }
      } catch (err) {
        console.error(`[tildai] ALERTA alta: no se pudo verificar el vault anterior de ${chatId}, no creamos otro por las dudas`, err);
        return { estado: "error", mensaje: "Ya mandé una transacción para tu caja y no pude verificar si quedó creada. Probá /start en un rato; no te voy a crear dos.", txHash: prev.txHash };
      }
    }

    // The cap counts sent txs (each one spends agent gas) and is persisted in the registry, so a restart doesn't reset it.
    if (registry.altasDelDia(this.o.now()) >= this.o.maxAltasDia) {
      console.error(`[tildai] ALERTA alta: tope diario de ${this.o.maxAltasDia} altas alcanzado; el chat ${chatId} quedó afuera`);
      return { estado: "error", mensaje: `Hoy ya di de alta el máximo de comercios que puedo (${this.o.maxAltasDia}). Probá /start mañana.` };
    }

    let sentHash: Hex | undefined;
    try {
      const { request } = await reader.simulateContract({ account: wallet.account, address: factory, abi: factoryAbi, functionName: "createVault", args: [owner, owner, capWei, MAX_RATE, MAX_SWAP] });
      sentHash = await wallet.writeContract(feeCurrency ? { ...request, feeCurrency } : request);
      await registry.set(chatId, { ...base, estado: "enviada", txHash: sentHash }, { gastarAlta: true, now: this.o.now() });
      const receipt = await reader.waitForTransactionReceipt({ hash: sentHash });
      if (receipt.status !== "success") throw new Error(`la tx ${sentHash} se revirtió`);
      const vault = this.vaultDelRecibo((receipt as any).logs ?? []);
      await registry.set(chatId, { ...base, estado: "creado", vault, fromBlock: String(receipt.blockNumber ?? ""), txHash: sentHash });
      return { estado: "creado", vault, resumen: this.resumen(vault, capWei) };
    } catch (err) {
      const txHash = sentHash;
      const error = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
      await registry.set(chatId, { ...base, estado: "error", error, ...(txHash ? { txHash } : {}) });
      console.error(`[tildai] ALERTA alta del chat ${chatId}: ${error}`);
      return {
        estado: "error",
        txHash,
        mensaje: txHash
          ? "Mandé la transacción pero no la pude confirmar. Probá /start en un rato: la verifico en la cadena antes de crear otra, no te va a quedar duplicada."
          : `No pude crear tu caja ahora (${error}). No se movió nada: probá /start de nuevo en un rato.`,
      };
    }
  }

  private resumen(vault: Address, capWei: bigint) {
    const link = `${this.o.payBaseUrl.replace(/\/$/, "")}/?vault=${vault}`;
    return [
      `Tu caja está creada: ${vault}`,
      `Tu QR fijo para cobrar es este link: ${link} (el cliente elige el monto y paga sin gas).`,
      `Tus límites: tope diario ${formatPesos(capWei)} · el dólar sale como máximo ${formatPesos(MAX_RATE)} por USD₮ · cada dolarización hasta ${formatPesos(MAX_SWAP)}.`,
      "La plata es siempre tuya: solo vos podés sacarla, yo solo opero dentro de esos límites.",
    ].join("\n");
  }
}

const vaultCreatedEventArgs = factoryAbi.find((x) => x.type === "event" && x.name === "VaultCreated")!;
