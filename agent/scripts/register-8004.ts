// Registers the agent's ERC-8004 identity from its own wallet (docs.celo.org/build-on-celo/build-with-ai/8004).
// Two tagged txs: register(uri) and then setAgentURI with the `registrations` entry, which needs the minted id.
// Idempotent: if the agent wallet already owns an identity, it does nothing.
// Usage (from agent/): node scripts/register-8004.ts celoSepolia | celo
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { verifyTx } from "@celo/attribution-tags";
import { parseAbi, parseEventLogs, type Hex } from "viem";
import { agentClients, ATTRIBUTION_CODE } from "../src/chain.ts";

const network = process.argv[2];
assert.ok(network === "celo" || network === "celoSepolia", "uso: node scripts/register-8004.ts celoSepolia|celo");
const net = {
  celo: { chainId: 42220, registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", file: "celo.json" },
  celoSepolia: { chainId: 11142220, registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e", file: "celo-sepolia.json" },
}[network];
// Mainnet gas in USD₮ through its fee-currency adapter (docs.celo.org fee abstraction); testnet pays in CELO.
const feeCurrency = network === "celo" ? ("0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" as const) : undefined;

process.loadEnvFile();
const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
assert.ok(key, "falta AGENT_PRIVATE_KEY en agent/.env");
const { wallet, reader } = agentClients(network, key);
const agent = wallet.account.address;

const abi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

const outFile = new URL(`../../contracts/deployments/${net.file}`, import.meta.url);
const state = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { chainId: net.chainId, agent };

if ((await reader.readContract({ address: net.registry, abi, functionName: "balanceOf", args: [agent] })) > 0n) {
  console.log(`La wallet ${agent} ya tiene identidad ERC-8004 (agentId guardado: ${state.agentId ?? "desconocido"}). No hago nada.`);
  process.exit(0);
}

// shortcut: data: URI stored onchain, so there is nothing to host; switch to the web URL with setAgentURI once it exists.
const toUri = (agentId?: bigint) =>
  "data:application/json;base64," +
  Buffer.from(
    JSON.stringify({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Tildai",
      description:
        "Agente de caja para comercios de barrio en Argentina: cobra en wARS sobre Celo, avisa cada venta, cierra la caja, aparta ahorro e impuestos y dolariza el excedente en Textile FX.",
      services: [{ name: "web", endpoint: "https://github.com/Antony27c/Tildai" }],
      x402Support: false,
      active: true,
      supportedTrust: ["reputation"],
      ...(agentId !== undefined && {
        registrations: [{ agentId: Number(agentId), agentRegistry: `eip155:${net.chainId}:${net.registry}` }],
      }),
    }),
  ).toString("base64");

async function send(label: string, functionName: "register" | "setAgentURI", args: readonly unknown[]) {
  const { request } = await reader.simulateContract({ account: wallet.account, address: net.registry, abi, functionName, args } as never);
  const hash = await wallet.writeContract({ ...(request as object), feeCurrency } as never);
  const receipt = await reader.waitForTransactionReceipt({ hash, confirmations: 2 });
  assert.equal(receipt.status, "success", `${label}: tx revertida ${hash}`);
  const tag = await verifyTx({ client: reader, hash });
  assert.ok(tag?.codes.includes(ATTRIBUTION_CODE), `${label}: la tx ${hash} no lleva el attribution tag`);
  console.log(`✓ ${label}  ${hash}`);
  return receipt;
}

const registered = await send("register", "register", [toUri()]);
// The id comes from the event, not from register()'s return value (docs: it can be stale under concurrency).
const [event] = parseEventLogs({ abi, eventName: "Registered", logs: registered.logs });
const agentId = event.args.agentId;
assert.equal(event.args.owner, agent);
state.agentId = agentId.toString();
writeFileSync(outFile, JSON.stringify(state, null, 2) + "\n");

await send("setAgentURI con registrations", "setAgentURI", [agentId, toUri(agentId)]);
assert.equal(await reader.readContract({ address: net.registry, abi, functionName: "tokenURI", args: [agentId] }), toUri(agentId));
console.log(`Identidad ERC-8004 del agente: agentId ${agentId} en ${network} (owner ${agent})`);
