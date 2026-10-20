import { isAddress, parseEventLogs, type Address, type Hex } from "viem";

import { factoryAbi, type ChainReader } from "./chainVault.ts";
import { escribirJsonAtomico, leerJson } from "./jsonFile.ts";
import { formatPesos, parsePesosTexto, pesosToWei } from "./money.ts";
import { dayIndex } from "./sales.ts";
import type { OpsReader, OpsWallet } from "./vaultOps.ts";

export const MAX_RATE = 1_700n * 10n ** 18n; // wARS (wei) por USD₮ entero
export const MAX_SWAP = 60_000n * 10n ** 18n;
export const SUGERIDO_TOPE = 100_000;

/** Number env with a default; an EMPTY value (as .env.example ships) falls back to the default, not to 0. */
export function numEnv(nombre: string, defecto: string): number {
  return Number(process.env[nombre] || defecto);
}

// Sanity bound for the vault's max rate: over this it stops protecting the merchant (TILDAI_MAX_RATE is ARS per USD₮).
const MAX_RATE_CORDURA = 50_000;

/** wARS (wei) per whole USD₮ for createVault. Required on mainnet (no default — fix it from the day's Textile quote); Sepolia keeps the test default. */
export function maxRateAlta(): bigint {
  const raw = process.env.TILDAI_MAX_RATE;
  if (!raw) {
    if (process.env.TILDAI_NETWORK !== "celoSepolia") throw new Error("Falta TILDAI_MAX_RATE (pesos por USD₮, ej. '1.700'): es obligatoria en mainnet, sin default");
    return MAX_RATE;
  }
  const pesos = parsePesosTexto(raw);
  if (pesos === null || pesos > MAX_RATE_CORDURA) throw new Error(`TILDAI_MAX_RATE=${raw} fuera de rango (de 0 a ${MAX_RATE_CORDURA.toLocaleString("es-AR")} pesos por USD₮)`);
  return pesosToWei(pesos);
}

export type ChatEntry = {
  estado: "creado" | "enviada" | "error";
  owner: Address;
  dailyCap: string;
  vault?: Address;
  fromBlock?: string;
  txHash?: Hex;
  /** Nonce of the sent tx: only a consumed nonce proves a dropped tx can never mine. */
  nonce?: number;
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
      const d = leerJson(file, "de comercios");
      for (const [k, v] of Object.entries(d?.chats ?? {})) r.map.set(k, v as ChatEntry);
      if (typeof d?.altas?.dia === "number" && typeof d?.altas?.count === "number") r.altas = d.altas;
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

  /** Writes are queued so two signups in flight can never race the same tmp file. */
  private cola: Promise<void> = Promise.resolve();
  private persistir() {
    this.cola = this.cola.then(() => escribirJsonAtomico(this.file!, { version: 1, altas: this.altas, chats: Object.fromEntries(this.map) }));
    return this.cola;
  }

  /**
   * Takes one daily slot BEFORE the first await: simultaneous /start from different chats all read
   * the in-memory bump, so they can't all slip under the cap. Persisted before gas is spent.
   */
  async reservarAlta(now: number, max: number): Promise<boolean> {
    if (this.altasDelDia(now) >= max) return false;
    this.altas = { dia: dayIndex(now), count: this.altasDelDia(now) + 1 };
    if (this.file) await this.persistir();
    return true;
  }

  /** Gives a slot back when nothing could have been sent (a failed simulation spends no gas). */
  async devolverAlta(now: number) {
    if (this.altas.dia === dayIndex(now) && this.altas.count > 0) this.altas = { ...this.altas, count: this.altas.count - 1 };
    if (this.file) await this.persistir();
  }

  async set(chatId: string, e: ChatEntry) {
    this.map.set(chatId, e);
    if (this.file) await this.persistir();
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

/** One-shot marks per chat (a "closed sign-up" reply per process): strangers can't drain the bot's Telegram quota. */
export function deberiaAvisar(chatId: string, avisados: Set<string>): boolean {
  if (avisados.has(chatId)) return false;
  avisados.add(chatId);
  return true;
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
  /** Max wARS (wei) per whole USD₮ the new vault accepts in a swap (env TILDAI_MAX_RATE). */
  maxRate?: bigint;
  now?: () => number;
};

export class CreadorVault {
  private o: Required<Omit<CreadorOpts, "feeCurrency">> & { feeCurrency?: Address };

  constructor(o: CreadorOpts) {
    const { maxAltasDia = 5, pendienteMin = 30, maxRate = MAX_RATE, now = Date.now, ...rest } = o;
    this.o = { ...rest, maxAltasDia, pendienteMin, maxRate, now };
  }

  /** The vault address always comes from the VaultCreated log: never from a simulated return value. */
  private vaultDelRecibo(logs: any[]): Address {
    const e = parseEventLogs({ abi: factoryAbi, eventName: "VaultCreated", logs })[0];
    const vault = e?.args?.vault;
    if (!vault) throw new Error("la tx confirmó pero no trajo el evento VaultCreated");
    return vault as Address;
  }

  /** Latest vault this factory created for the owner, with its log block; used to recover after a tx was sent but not confirmed. */
  async findVaultByOwner(owner: Address): Promise<{ vault: Address; block: bigint } | null> {
    const latest = await this.o.reader.getBlockNumber();
    const logs: any[] = [];
    for (let a = this.o.fromBlock; a <= latest; a += 10_000n) {
      const b = a + 9_999n < latest ? a + 9_999n : latest;
      logs.push(...(await this.o.reader.getLogs({ address: this.o.factory, event: vaultCreatedEventArgs, args: { owner }, fromBlock: a, toBlock: b })));
    }
    const last = logs.at(-1);
    return last ? { vault: last.args.vault as Address, block: BigInt(last.blockNumber) } : null;
  }

  /**
   * Whether a sent tx can never mine anymore: only a consumed nonce proves it (a node not knowing
   * the tx can be a load-balancer gap, not a drop). Throws on any read doubt, so the caller never
   * sends a second createVault by mistake. Without a nonce or with the nonce still free: false.
   */
  private async txDescartada(txHash: Hex, nonce: number | undefined): Promise<boolean> {
    const { reader, wallet } = this.o;
    if (!reader.getTransaction || !reader.getTransactionCount) throw new Error("el reader no puede inspeccionar la tx (faltan getTransaction/getTransactionCount)");
    let tx: { nonce?: number; blockNumber?: bigint | null } | null = null;
    try {
      tx = await reader.getTransaction({ hash: txHash });
    } catch (err) {
      if ((err as Error).name !== "TransactionNotFoundError") throw err;
    }
    if (tx?.blockNumber != null) throw new Error(`la tx ${txHash} figura minada pero no tiene recibo`);
    const n = nonce ?? tx?.nonce;
    if (n == null) return false; // without the nonce there's no proof the tx was dropped: keep it pending
    const confirmed = await reader.getTransactionCount({ address: wallet.account.address, blockTag: "latest" });
    return BigInt(confirmed) > BigInt(n);
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
    const { registry, factory, reader, wallet, feeCurrency, maxRate } = this.o;
    const prev = registry.get(chatId);
    if (prev?.vault) return { estado: "ya_existente", vault: prev.vault, resumen: this.resumen(prev.vault, BigInt(prev.dailyCap)) };
    if (!isAddress(ownerRaw)) return { estado: "error", mensaje: "Esa no es una wallet válida: tiene que ser una dirección 0x… de 42 caracteres. Pasámela de nuevo." };
    const owner = ownerRaw as Address;
    if (owner.toLowerCase() === wallet.account.address.toLowerCase()) {
      return { estado: "error", mensaje: "Esa es mi wallet, no la tuya: el alta necesita una dirección donde el dueño firme (MiniPay o Valora). Pasame la del dueño." };
    }
    const base = { owner, dailyCap: capWei.toString(), at: this.o.now() };
    let barridoHecho = false;

    // If a previous tx went out without a confirmed result, check onchain before creating a second vault.
    if (prev?.txHash && !prev.vault) {
      const pendiente = { estado: "pendiente" as const, mensaje: "Tu caja todavía se está creando: la transacción está en la cadena pero sin confirmar. En un rato probá /start de nuevo y te confirmo.", txHash: prev.txHash };
      const duda = { estado: "error" as const, mensaje: "Ya mandé una transacción para tu caja y no pude verificar si quedó creada. Probá /start en un rato; no te voy a crear dos.", txHash: prev.txHash };
      let receipt: { status: string; logs?: any[]; blockNumber?: bigint } | null = null;
      try {
        receipt = (await reader.getTransactionReceipt?.({ hash: prev.txHash })) ?? null;
      } catch (err) {
        if ((err as Error).name !== "TransactionReceiptNotFoundError") {
          console.error(`[tildai] ALERTA alta: no se pudo leer el recibo de ${prev.txHash} del chat ${chatId}`, err);
          return duda;
        }
      }
      if (receipt === null) {
        // An unmined tx can sit in the mempool or have been dropped/replaced. An in-flight ("enviada")
        // attempt waits out the timeout; an "error" entry already paid it once, so it re-checks at once.
        if (prev.estado === "enviada" && this.o.now() - prev.at < this.o.pendienteMin * 60_000) return pendiente;
        let descartada: boolean;
        try {
          descartada = await this.txDescartada(prev.txHash, prev.nonce);
        } catch (err) {
          console.error(`[tildai] ALERTA alta: no se pudo saber si la tx ${prev.txHash} del chat ${chatId} sigue viva`, err);
          return duda;
        }
        if (!descartada) return pendiente;
        // The tx can never land now; before failing the alta, sweep the factory logs anyway in case it did.
        barridoHecho = true;
        try {
          const found = await this.findVaultByOwner((prev.owner ?? owner) as Address);
          if (found) {
            await registry.set(chatId, { ...base, estado: "creado", vault: found.vault, fromBlock: String(found.block), txHash: prev.txHash, nonce: prev.nonce });
            return { estado: "ya_existente", vault: found.vault, resumen: this.resumen(found.vault, capWei) };
          }
        } catch (err) {
          console.error(`[tildai] ALERTA alta: no se pudo verificar el vault anterior de ${chatId}, no creamos otro por las dudas`, err);
          return duda;
        }
        // Without txHash: the next /start skips this recovery path and retries for real (the hash stays in the message).
        await registry.set(chatId, { ...base, estado: "error", nonce: prev.nonce, error: `la tx ${prev.txHash} quedó descartada sin crear el vault` });
        return { estado: "error", mensaje: "La transacción para crear tu caja quedó descartada por la red y el vault no se creó (la verifiqué en la cadena). Probá /start de nuevo." };
      }
      try {
        // Search by the stored owner too: the first tx used it, a changed wallet doesn't matter for recovery.
        let found: Address | undefined;
        let foundBlock: bigint | undefined;
        if (receipt.status === "success") {
          found = this.vaultDelRecibo(receipt.logs ?? []);
          foundBlock = receipt.blockNumber ?? (receipt.logs ?? []).at(-1)?.blockNumber;
        } else {
          barridoHecho = true;
          const f = await this.findVaultByOwner((prev.owner ?? owner) as Address);
          found = f?.vault;
          foundBlock = f?.block;
        }
        if (found) {
          await registry.set(chatId, { ...base, estado: "creado", vault: found, fromBlock: String(foundBlock ?? ""), txHash: prev.txHash, nonce: prev.nonce });
          return { estado: "ya_existente", vault: found, resumen: this.resumen(found, capWei) };
        }
      } catch (err) {
        console.error(`[tildai] ALERTA alta: no se pudo verificar el vault anterior de ${chatId}, no creamos otro por las dudas`, err);
        return { estado: "error", mensaje: "Ya mandé una transacción para tu caja y no pude verificar si quedó creada. Probá /start en un rato; no te voy a crear dos.", txHash: prev.txHash };
      }
    }

    // Any earlier attempt (even without a stored hash: a timeout after broadcast or a crash before
    // registry.set) may have landed. Sweep the factory once before sending; a read doubt means no tx.
    if (prev && !prev.vault && !barridoHecho) {
      try {
        const found = await this.findVaultByOwner((prev.owner ?? owner) as Address);
        if (found) {
          await registry.set(chatId, { ...base, estado: "creado", vault: found.vault, fromBlock: String(found.block), txHash: prev.txHash, nonce: prev.nonce });
          return { estado: "ya_existente", vault: found.vault, resumen: this.resumen(found.vault, capWei) };
        }
      } catch (err) {
        console.error(`[tildai] ALERTA alta: no se pudo verificar el intento anterior de ${chatId}, no creamos otro por las dudas`, err);
        return { estado: "error", mensaje: "Tuve un intento anterior creando tu caja y no pude verificar si quedó creada. Probá /start en un rato; no te voy a crear dos." };
      }
    }

    // Reserve the daily slot BEFORE the first await: parallel /start from different chats can't all slip under the cap.
    const now = this.o.now();
    if (!(await registry.reservarAlta(now, this.o.maxAltasDia))) {
      console.error(`[tildai] ALERTA alta: tope diario de ${this.o.maxAltasDia} altas alcanzado; el chat ${chatId} quedó afuera`);
      return { estado: "error", mensaje: `Hoy ya di de alta el máximo de comercios que puedo (${this.o.maxAltasDia}). Probá /start mañana.` };
    }

    let sentHash: Hex | undefined;
    let nonce: number | undefined;
    let pudoSalir = false; // once writeContract runs, the tx may already be on the wire: the slot stays spent
    try {
      const { request } = await reader.simulateContract({ account: wallet.account, address: factory, abi: factoryAbi, functionName: "createVault", args: [owner, owner, capWei, maxRate, MAX_SWAP] });
      pudoSalir = true;
      sentHash = await wallet.writeContract(feeCurrency ? { ...request, feeCurrency } : request);
      nonce = (request as { nonce?: number }).nonce ?? (await reader.getTransaction?.({ hash: sentHash }).catch(() => null))?.nonce;
      await registry.set(chatId, { ...base, estado: "enviada", txHash: sentHash, nonce });
      const receipt = await reader.waitForTransactionReceipt({ hash: sentHash });
      if (receipt.status !== "success") throw new Error(`la tx ${sentHash} se revirtió`);
      const vault = this.vaultDelRecibo((receipt as any).logs ?? []);
      await registry.set(chatId, { ...base, estado: "creado", vault, fromBlock: String((receipt as any).blockNumber ?? ""), txHash: sentHash, nonce });
      return { estado: "creado", vault, resumen: this.resumen(vault, capWei) };
    } catch (err) {
      if (!pudoSalir) await registry.devolverAlta(now).catch((e) => console.error("[tildai] no pude devolver el cupo de alta", e));
      const txHash = sentHash;
      const error = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
      await registry.set(chatId, { ...base, estado: "error", error, ...(txHash ? { txHash, nonce } : {}) });
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
      `Tus límites: tope diario ${formatPesos(capWei)} · el dólar sale como máximo ${formatPesos(this.o.maxRate)} por USD₮ · cada dolarización hasta ${formatPesos(MAX_SWAP)}.`,
      "La plata es siempre tuya: solo vos podés sacarla, yo solo opero dentro de esos límites.",
    ].join("\n");
  }
}

const vaultCreatedEventArgs = factoryAbi.find((x) => x.type === "event" && x.name === "VaultCreated")!;
