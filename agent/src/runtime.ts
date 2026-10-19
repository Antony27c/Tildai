import { createPublicClient, http, type Address, type Hex } from "viem";
import { celo, celoSepolia } from "viem/chains";

import { agentClients } from "./chain.ts";
import { ChainVault } from "./chainVault.ts";
import { SalesBook } from "./sales.ts";
import { FakeVault, type Vault } from "./vault.ts";
import { VaultOps } from "./vaultOps.ts";

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

export const book = new SalesBook(vault);
export const payBaseUrl = () => process.env.TILDAI_PAY_BASE_URL ?? "http://localhost:3000";
export const rampChainId = () => (network === "celo" ? 42220 : 11142220);

let ops: VaultOps | undefined;
/** Writes go only through agentClients() (attribution tag). Reads the key lazily and never logs it. */
export function vaultOps() {
  if (!vaultAddress) throw new Error("Falta TILDAI_VAULT: sin vault real no se mueven fondos");
  if (!ops) ops = new VaultOps({ vault: vaultAddress, ...agentClients(network, need("AGENT_PRIVATE_KEY") as Hex) });
  return ops;
}
