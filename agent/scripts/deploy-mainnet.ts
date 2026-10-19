// Deploys TildaiFactory on Celo mainnet with the real wARS, USD₮ and Textile addresses. Gas in USD₮ (fee abstraction).
// Every tx is checked onchain for the attribution code. Idempotent: an existing factory in deployments/celo.json is reused.
// Usage (from agent/, after `forge build` in contracts/):
//   node scripts/deploy-mainnet.ts            -> dry run: simulates the deploy with eth_call, sends nothing
//   CONFIRM_MAINNET=1 node scripts/deploy-mainnet.ts  -> sends the tx (needs the owner's OK and USD₮ for gas)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { verifyTx } from "@celo/attribution-tags";
import { encodeDeployData, formatUnits, parseAbi, type Abi, type Hex } from "viem";
import { agentClients, ATTRIBUTION_CODE } from "../src/chain.ts";

// Sources: AGENTS.md (wARS), docs.textilecredit.com/protocol/address-book (Celo), docs.celo.org fee abstraction (adapter).
const WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const USDT_ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const TEXTILE = ["0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3", "0x01b006d5c687bde182aa36F542f1f014144742e2"];

process.loadEnvFile();
const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
assert.ok(key, "falta AGENT_PRIVATE_KEY en agent/.env");
const { wallet, reader } = agentClients("celo", key);
const agent = wallet.account.address;
assert.equal(await reader.getChainId(), 42220, "el RPC no es Celo mainnet");

const outFile = new URL("../../contracts/deployments/celo.json", import.meta.url);
const state = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { chainId: 42220, agent };
if (state.factory) {
  console.log(`Ya hay una factory en mainnet: ${state.factory}. No hago nada.`);
  process.exit(0);
}

const art = JSON.parse(readFileSync(new URL("../../contracts/out/TildaiFactory.sol/TildaiFactory.json", import.meta.url), "utf8"));
const data = encodeDeployData({ abi: art.abi as Abi, bytecode: art.bytecode.object as Hex, args: [WARS, USDT, agent, TEXTILE] });

for (const a of [WARS, USDT, ...TEXTILE]) assert.ok(((await reader.getCode({ address: a as Hex })) ?? "0x") !== "0x", `${a} no tiene código en mainnet`);
await reader.call({ account: agent, data }); // reverts here if the constructor would revert
const usdtGas = await reader.readContract({ address: USDT, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [agent] });
console.log(`Simulación OK. Agente ${agent}, saldo USD₮ para gas: ${formatUnits(usdtGas, 6)}`);

if (process.env.CONFIRM_MAINNET !== "1") {
  console.log("Dry run: no se mandó nada. Para desplegar: CONFIRM_MAINNET=1 node scripts/deploy-mainnet.ts");
  process.exit(0);
}
assert.ok(usdtGas > 0n, "el agente no tiene USD₮ para pagar el gas");

// Not wallet.deployContract: withAttribution doesn't wrap it, so the tx would go out untagged.
const hash = await wallet.sendTransaction({ data, feeCurrency: USDT_ADAPTER });
const receipt = await reader.waitForTransactionReceipt({ hash, confirmations: 2 });
assert.equal(receipt.status, "success", `deploy revertido ${hash}`);
const tag = await verifyTx({ client: reader, hash });
assert.ok(tag?.codes.includes(ATTRIBUTION_CODE), `la tx ${hash} no lleva el attribution tag`);
state.factory = receipt.contractAddress;
state.factoryBlock = receipt.blockNumber.toString();
writeFileSync(outFile, JSON.stringify(state, null, 2) + "\n");
console.log(`✓ TildaiFactory en mainnet: ${state.factory} (bloque ${state.factoryBlock}, tx ${hash})`);
