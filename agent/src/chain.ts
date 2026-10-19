import { withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";

// Code assigned by Loops House for Agents on Open Rails. Every agent tx must carry it (AGENTS.md rule 2).
export const ATTRIBUTION_CODE = "celo_c376b2fd04bc";

/** Wallet client that tags every tx it sends, plus a public client on the same chain. */
export function agentClients(network: "celo" | "celoSepolia", privateKey: Hex) {
  const chain = network === "celo" ? celo : celoSepolia;
  const wallet = createWalletClient({ account: privateKeyToAccount(privateKey), chain, transport: http() }).extend(
    withAttribution(ATTRIBUTION_CODE),
  );
  return { wallet, reader: createPublicClient({ chain, transport: http() }) };
}
