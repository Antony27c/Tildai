import { mkdirSync, readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { isAddress, parseEventLogs, type Address, type Hex } from "viem";

import { factoryAbi, type ChainReader } from "./chainVault.ts";
import { formatPesos } from "./money.ts";
import type { OpsReader, OpsWallet } from "./vaultOps.ts";

export const MAX_RATE = 1_700n * 10n ** 18n; // wARS (wei) por USD₮ entero
export const MAX_SWAP = 60_000n * 10n ** 18n;
export const SUGERIDO_TOPE = 100_000;

export type ChatEntry = {
  estado: "creado" | "enviada" | "error";
  owner: Address;
  dailyCap: string;
  vault?: Address;
  txHash?: Hex;
  error?: string;
  at: number;
};

// shortcut: JSON local por proceso, compartido con nadie; si el agente corre en varios procesos, esto pasa a una base.
export class ChatVaultRegistry {
  private map = new Map<string, ChatEntry>();
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
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`El archivo de comercios está corrupto (${file}): ${(e as Error).message}`);
      }
    }
    return r;
  }

  get(chatId: string) {
    return this.map.get(chatId);
  }

  async set(chatId: string, e: ChatEntry) {
    this.map.set(chatId, e);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      const f = await open(tmp, "w");
      try {
        await f.writeFile(JSON.stringify({ version: 1, chats: Object.fromEntries(this.map) }, null, 2), "utf8");
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(tmp, this.file);
    }
  }
}

export type AltaResult =
  | { estado: "creado" | "ya_existente"; vault: Address; resumen: string }
  | { estado: "error"; mensaje: string; txHash?: Hex };

export class CreadorVault {
  private o: { registry: ChatVaultRegistry; factory: Address; fromBlock: bigint; reader: OpsReader & ChainReader; wallet: OpsWallet; feeCurrency?: Address; payBaseUrl: string };

  constructor(o: { registry: ChatVaultRegistry; factory: Address; fromBlock: bigint; reader: OpsReader & ChainReader; wallet: OpsWallet; feeCurrency?: Address; payBaseUrl: string }) {
    this.o = o;
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

  async crear(chatId: string, ownerRaw: string, capWei: bigint): Promise<AltaResult> {
    const { registry, factory, reader, wallet, feeCurrency } = this.o;
    const prev = registry.get(chatId);
    if (prev?.vault) return { estado: "ya_existente", vault: prev.vault, resumen: this.resumen(prev.vault, BigInt(prev.dailyCap)) };
    if (!isAddress(ownerRaw)) return { estado: "error", mensaje: "Esa no es una wallet válida: tiene que ser una dirección 0x… de 42 caracteres. Pasámela de nuevo." };
    const owner = ownerRaw as Address;
    const base = { owner, dailyCap: capWei.toString(), at: Date.now() };

    // If a previous tx went out without a confirmed result, check onchain before creating a second vault.
    if (prev?.txHash && !prev.vault) {
      try {
        const receipt = await reader.getTransactionReceipt({ hash: prev.txHash }).catch(() => null);
        const found = receipt?.status === "success" ? this.vaultDelRecibo(receipt.logs ?? []) : await this.findVaultByOwner(owner);
        if (found) {
          await registry.set(chatId, { ...base, estado: "creado", vault: found, txHash: prev.txHash });
          return { estado: "ya_existente", vault: found, resumen: this.resumen(found, capWei) };
        }
      } catch (err) {
        console.error(`[tildai] ALERTA alta: no se pudo verificar el vault anterior de ${chatId}, no creamos otro por las dudas`, err);
        return { estado: "error", mensaje: "Ya mandé una transacción para tu caja y no pude verificar si quedó creada. Probá /start en un rato; no te voy a crear dos.", txHash: prev.txHash };
      }
    }

    let sentHash: Hex | undefined;
    try {
      const { request } = await reader.simulateContract({ account: wallet.account, address: factory, abi: factoryAbi, functionName: "createVault", args: [owner, owner, capWei, MAX_RATE, MAX_SWAP] });
      sentHash = await wallet.writeContract(feeCurrency ? { ...request, feeCurrency } : request);
      await registry.set(chatId, { ...base, estado: "enviada", txHash: sentHash });
      const receipt = await reader.waitForTransactionReceipt({ hash: sentHash });
      if (receipt.status !== "success") throw new Error(`la tx ${sentHash} se revirtió`);
      const vault = this.vaultDelRecibo((receipt as any).logs ?? []);
      await registry.set(chatId, { ...base, estado: "creado", vault, txHash: sentHash });
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
