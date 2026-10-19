import { createPublicClient, http, type Address, type Hex } from "viem";
import { celo, celoSepolia } from "viem/chains";

import { agentClients } from "./chain.ts";
import { ChainVault } from "./chainVault.ts";
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
    creador = new CreadorVault({
      registry: ChatVaultRegistry.load(process.env.TILDAI_REGISTRY ?? "data/chats.json"),
      factory,
      fromBlock: BigInt(need("TILDAI_FROM_BLOCK")),
      feeCurrency: network === "celo" ? USDT_FEE_ADAPTER : undefined,
      payBaseUrl: payBaseUrl(),
      ...agentClients(network, need("AGENT_PRIVATE_KEY") as Hex),
    });
  }
  return creador;
}
