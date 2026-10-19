import { createPublicClient, http, type Address, type Hex } from "viem";
import { celo, celoSepolia } from "viem/chains";

import { agentClients } from "./chain.ts";
import { EventCursor } from "./avisos.ts";
import { ChainVault, type Balances } from "./chainVault.ts";
import { indexerClient, IndexerVault, type Indexer } from "./indexerClient.ts";
import { SalesBook } from "./sales.ts";
import { FakeVault, type Vault } from "./vault.ts";
import { ChatVaultRegistry, CreadorVault } from "./alta.ts";
import { VaultOps, type Fx } from "./vaultOps.ts";

const network = process.env.TILDAI_NETWORK === "celoSepolia" ? "celoSepolia" : "celo";
const vaultAddress = process.env.TILDAI_VAULT as Address | undefined;

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name}`);
  return v;
}

// Real session chat of the current tool call (set by the channel's auth, never by the model).
type ToolCtx = { session?: { auth?: { current?: { attributes?: Record<string, unknown> } | null } } };
export function chatIdDe(ctx: ToolCtx): string {
  const a = ctx?.session?.auth?.current?.attributes;
  const id = a?.chat_id;
  if (typeof id !== "string" || !id) throw new Error("Esto solo funciona desde un chat de Telegram");
  if (a?.chat_type !== "private") throw new Error("Hablamos por privado, no en grupo: es tu plata");
  return id;
}

let registry: ChatVaultRegistry | undefined;
export function chatRegistry() {
  return (registry ??= ChatVaultRegistry.load(process.env.TILDAI_REGISTRY ?? "data/chats.json"));
}

// Env vault is only for the configured owner chat; a chat without its own vault can only onboard.
export function vaultDelChat(ctx: ToolCtx): { address: Address; fromBlock: bigint } {
  const chatId = chatIdDe(ctx);
  const reg = chatRegistry().get(chatId);
  if (reg?.vault) return { address: reg.vault, fromBlock: reg.fromBlock ? BigInt(reg.fromBlock) : 0n };
  if (chatId === process.env.TILDAI_OWNER_CHAT_ID && vaultAddress) return { address: vaultAddress, fromBlock: BigInt(need("TILDAI_FROM_BLOCK")) };
  throw new Error("Todavía no tenés caja: hacé /start para crearla");
}

let reader: ReturnType<typeof createPublicClient> | undefined;
const publicReader = () => (reader ??= createPublicClient({ chain: network === "celo" ? celo : celoSepolia, transport: http() }));

let idx: Indexer | null | undefined;
/** The payments indexer: source of truth for sales when TILDAI_INDEXER_URL + TILDAI_INDEXER_TOKEN are set. */
export function indexer(): Indexer | undefined {
  if (idx === undefined) {
    const baseUrl = process.env.TILDAI_INDEXER_URL;
    const token = process.env.TILDAI_INDEXER_TOKEN;
    if ((baseUrl && !token) || (!baseUrl && token)) {
      console.error("[tildai] TILDAI_INDEXER_URL y TILDAI_INDEXER_TOKEN van juntas: falta una, indexer deshabilitado");
    }
    idx = baseUrl && token ? indexerClient({ baseUrl, token }) : null;
  }
  return idx ?? undefined;
}

let events: EventCursor | undefined;
export function eventCursor() {
  return (events ??= EventCursor.load(process.env.TILDAI_EVENTS_FILE ?? "data/eventos.json"));
}

const books = new Map<string, { book: SalesBook; balances: () => Promise<Balances> }>();
/** Book and onchain balances for one vault, cached by address (used by tools and by the daily close). */
export function datosDelVault(v: { address: Address; fromBlock: bigint }) {
  let e = books.get(v.address);
  if (!e) {
    const cv = new ChainVault({ address: v.address, reader: publicReader(), fromBlock: v.fromBlock });
    // With an indexer configured it is the source of truth for sales; onchain reads stay as verification.
    const idx = indexer();
    const src: Vault = idx ? new IndexerVault(v.address, idx) : cv;
    books.set(v.address, (e = { book: new SalesBook(src), balances: () => cv.balances() }));
  }
  return e;
}

export function bookDelChat(ctx: ToolCtx): SalesBook {
  return datosDelVault(vaultDelChat(ctx)).book;
}

const opsByVault = new Map<string, VaultOps>();
export function opsDelVault(address: Address): VaultOps {
  let o = opsByVault.get(address);
  if (!o) opsByVault.set(address, (o = new VaultOps({ vault: address, feeCurrency: network === "celo" ? USDT_FEE_ADAPTER : undefined, ...agentClients(network, need("AGENT_PRIVATE_KEY") as Hex) })));
  return o;
}
export function opsDelChat(ctx: ToolCtx): VaultOps {
  return opsDelVault(vaultDelChat(ctx).address);
}

/** Every chat→vault in the registry, plus the env vault of the owner chat if it isn't registered: used by the daily close and the sale notifications. */
export function vaultsConChat(): { chatId: string; vault: { address: Address; fromBlock: bigint } }[] {
  const jobs = chatRegistry().conVault().map((e) => ({ chatId: e.chatId, vault: { address: e.vault, fromBlock: e.fromBlock } }));
  const owner = process.env.TILDAI_OWNER_CHAT_ID;
  if (vaultAddress && owner && !jobs.some((j) => j.chatId === owner || j.vault.address === vaultAddress)) {
    jobs.push({ chatId: owner, vault: { address: vaultAddress, fromBlock: BigInt(need("TILDAI_FROM_BLOCK")) } });
  }
  return jobs;
}

// shortcut: one vault per process, taken from TILDAI_VAULT; without it reads use the in-memory fake and writes are disabled. Use the factory registry per merchant.
export const vault: Vault = vaultAddress
  ? new ChainVault({
      address: vaultAddress,
      reader: createPublicClient({ chain: network === "celo" ? celo : celoSepolia, transport: http() }),
      fromBlock: BigInt(need("TILDAI_FROM_BLOCK")),
    })
  : new FakeVault();

export const balances = vault instanceof ChainVault ? () => vault.balances() : undefined;
export const book = new SalesBook(vault);
export const payBaseUrl = () => process.env.TILDAI_PAY_BASE_URL ?? "http://localhost:3000";
export const rampChainId = () => (network === "celo" ? 42220 : 11142220);

// Official USDT fee-abstraction adapter (docs.celo.org/build-on-celo/fee-abstraction): on mainnet the agent holds no CELO and pays gas in USDT.
export const USDT_FEE_ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as const;

let ops: VaultOps | undefined;
/** Writes go only through agentClients() (attribution tag). Reads the key lazily and never logs it. */
export function vaultOps() {
  if (!vaultAddress) throw new Error("Falta TILDAI_VAULT: sin vault real no se mueven fondos");
  if (!ops) ops = new VaultOps({ vault: vaultAddress, feeCurrency: network === "celo" ? USDT_FEE_ADAPTER : undefined, ...agentClients(network, need("AGENT_PRIVATE_KEY") as Hex) });
  return ops;
}

// shortcut: fx/ has its own package.json and node_modules; loaded lazily so the agent runs without it until the first dolarizar. Move it into a workspace when the repo gets one.
export const fx: Fx = {
  cotizar: async (monto) => (await import("../../fx/index.ts")).cotizar(monto),
  cotizarFirme: async (p) => (await import("../../fx/index.ts")).cotizarFirme(p),
};

let creador: CreadorVault | undefined;
/** Onboarding writes also go only through agentClients() (attribution tag, USD₮ gas on mainnet). */
export function creadorVault() {
  const factory = process.env.TILDAI_FACTORY as Address | undefined;
  if (!factory) throw new Error("Falta TILDAI_FACTORY: no puedo dar de alta el comercio");
  if (!creador) {
    const maxAltas = Number(process.env.TILDAI_MAX_ALTAS_DIA ?? "5");
    const pendienteMin = Number(process.env.TILDAI_ALTA_PENDIENTE_MIN ?? "30");
    creador = new CreadorVault({
      registry: chatRegistry(),
      factory,
      fromBlock: BigInt(need("TILDAI_FROM_BLOCK")),
      feeCurrency: network === "celo" ? USDT_FEE_ADAPTER : undefined,
      payBaseUrl: payBaseUrl(),
      // Un tope inválido cierra las altas (0): ante la duda no se gasta gas.
      maxAltasDia: Number.isFinite(maxAltas) && maxAltas >= 0 ? Math.floor(maxAltas) : 0,
      pendienteMin: Number.isFinite(pendienteMin) && pendienteMin > 0 ? Math.floor(pendienteMin) : 30,
      ...agentClients(network, need("AGENT_PRIVATE_KEY") as Hex),
    });
  }
  return creador;
}
