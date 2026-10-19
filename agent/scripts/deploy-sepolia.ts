// Deploys TildaiFactory on Celo Sepolia with test tokens (wARS and USDT don't exist there) and runs a smoke test.
// Every tx goes through the tagged agent client and is checked onchain for the attribution code.
// Resumable: each address is saved as soon as it exists, and a rerun skips what is already there.
// Usage (from agent/, after `forge build` in contracts/): node scripts/deploy-sepolia.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { verifyTx } from "@celo/attribution-tags";
import { encodeDeployData, parseEventLogs, parseUnits, type Abi, type Address, type Hex } from "viem";
import { agentClients, ATTRIBUTION_CODE } from "../src/chain.ts";

process.loadEnvFile();
const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
assert.ok(key, "falta AGENT_PRIVATE_KEY en agent/.env");
const { wallet, reader } = agentClients("celoSepolia", key);
const agent = wallet.account.address;

const outFile = new URL("../../contracts/deployments/celo-sepolia.json", import.meta.url);
const state: Record<string, string> = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
const save = (name: string, value: string) => {
  state[name] = value;
  mkdirSync(new URL(".", outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ chainId: 11142220, agent, ...state }, null, 2) + "\n");
};

const artifact = (file: string, name: string) => {
  const json = JSON.parse(readFileSync(new URL(`../../contracts/out/${file}/${name}.json`, import.meta.url), "utf8"));
  return { abi: json.abi as Abi, bytecode: json.bytecode.object as Hex };
};

async function confirm(label: string, hash: Hex) {
  // 2 confirmations: forno balances across nodes, and a node one block behind returns empty reads.
  const receipt = await reader.waitForTransactionReceipt({ hash, confirmations: 2 });
  assert.equal(receipt.status, "success", `${label}: tx revertida ${hash}`);
  const tag = await verifyTx({ client: reader, hash });
  assert.ok(tag?.codes.includes(ATTRIBUTION_CODE), `${label}: la tx ${hash} no lleva el attribution tag`);
  console.log(`✓ ${label}  ${hash}`);
  return receipt;
}

async function deploy(name: string, file: string, contract: string, args: unknown[]) {
  if (state[name]) return state[name] as Address;
  const { abi, bytecode } = artifact(file, contract);
  // Not wallet.deployContract: withAttribution doesn't wrap it, so the tx would go out untagged.
  const receipt = await confirm(name, await wallet.sendTransaction({ data: encodeDeployData({ abi, bytecode, args }) }));
  save(name, receipt.contractAddress!);
  return receipt.contractAddress as Address;
}

async function write(label: string, address: Address, abi: Abi, functionName: string, args: unknown[]) {
  const { request } = await reader.simulateContract({ account: wallet.account, address, abi, functionName, args });
  return confirm(label, await wallet.writeContract(request));
}

const token = artifact("MockToken.sol", "MockToken");
const factoryArt = artifact("TildaiFactory.sol", "TildaiFactory");
const vaultArt = artifact("TildaiVault.sol", "TildaiVault");

const wars = await deploy("wars", "MockToken.sol", "MockToken", ["wARS (test)", 18]);
const usdt = await deploy("usdt", "MockToken.sol", "MockToken", ["USDT (test)", 6]);
const factory = await deploy("factory", "TildaiFactory.sol", "TildaiFactory", [wars, usdt, agent, []]);
assert.equal(await reader.readContract({ address: factory, abi: factoryArt.abi, functionName: "agent" }), agent);

// Smoke test vault: on testnet the agent is also owner and payout wallet.
let vault = state.smokeVault as Address | undefined;
if (!vault) {
  const created = await write("createVault", factory, factoryArt.abi, "createVault", [
    agent, agent, parseUnits("100000", 18), parseUnits("1700", 18), parseUnits("60000", 18),
  ]);
  const [event] = parseEventLogs({ abi: factoryArt.abi, eventName: "VaultCreated", logs: created.logs });
  vault = (event as unknown as { args: { vault: Address } }).args.vault;
  save("smokeVault", vault);
  await write("mint 10.000 wARS al vault", wars, token.abi, "mint", [vault, parseUnits("10000", 18)]);
  await write("allocate 2.000 a ahorro", vault, vaultArt.abi, "allocate", [`0x${"01".padStart(64, "0")}`, 1, parseUnits("2000", 18)]);
  await write("withdraw 1.000", vault, vaultArt.abi, "withdraw", [`0x${"02".padStart(64, "0")}`, parseUnits("1000", 18)]);
}
assert.equal(await reader.readContract({ address: vault, abi: vaultArt.abi, functionName: "operating" }), parseUnits("7000", 18));
assert.equal(await reader.readContract({ address: factory, abi: factoryArt.abi, functionName: "isVault", args: [vault] }), true);
console.log(state);
