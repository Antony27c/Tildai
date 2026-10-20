// Deploys TildaiFactory on Celo mainnet with the real wARS, USD₮ and Textile addresses. Gas in USD₮ (fee abstraction).
// Every tx is checked onchain for the attribution code. Idempotent: an existing factory in deployments/celo.json is reused,
// and a sent but unrecorded deploy (factoryTx without factory) is recovered from its receipt instead of redeployed.
// Usage (from agent/, after `forge build --force` in contracts/ from a clean checkout):
//   node scripts/deploy-mainnet.ts                     -> dry run: simulates the deploy with eth_call, sends nothing
//   PowerShell: $env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts   (cmd: set "CONFIRM_MAINNET=1")
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { verifyTx } from "@celo/attribution-tags";
import { encodeDeployData, formatUnits, getAddress, keccak256, parseAbi, type Abi, type Hex } from "viem";
import { agentClients, ATTRIBUTION_CODE } from "../src/chain.ts";

// Sources: AGENTS.md (wARS), docs.textilecredit.com/protocol/address-book (Celo), docs.celo.org fee abstraction (adapter).
const WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const USDT_ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const TEXTILE = ["0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3", "0x01b006d5c687bde182aa36F542f1f014144742e2"];
const factoryAbi = parseAbi(["function wars() view returns (address)", "function usdt() view returns (address)", "function agent() view returns (address)"]);

async function main() {
  // Read before any RPC call; every exit below is a return, never process.exit with an open HTTP handle (crashes Node on Windows).
  const confirmed = process.env.CONFIRM_MAINNET === "1";
  process.loadEnvFile();
  const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  assert.ok(key, "falta AGENT_PRIVATE_KEY en agent/.env");
  const { wallet, reader } = agentClients("celo", key);
  const agent = wallet.account.address;

  const outFile = new URL("../../contracts/deployments/celo.json", import.meta.url);
  const state = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { chainId: 42220, agent };
  const save = () => writeFileSync(outFile, JSON.stringify(state, null, 2) + "\n");
  if (state.factory) {
    console.log(`Ya hay una factory en mainnet: ${state.factory}. No hago nada.`);
    return;
  }

  assert.equal(await reader.getChainId(), 42220, "el RPC no es Celo mainnet");

  // Recovery: the deploy was sent but the run died before recording the address. Never redeploy blindly.
  if (state.factoryTx) {
    console.log(`Hay un deploy enviado sin registrar (${state.factoryTx}): busco su recibo, no redespliego.`);
    if (!confirmed) {
      console.log("Dry run: no escribo nada. Para recuperarlo: $env:CONFIRM_MAINNET=\"1\"; node scripts/deploy-mainnet.ts");
      return;
    }
    await finish(state.factoryTx as Hex);
    return;
  }

  const art = JSON.parse(readFileSync(new URL("../../contracts/out/TildaiFactory.sol/TildaiFactory.json", import.meta.url), "utf8"));
  const bytecode = art.bytecode.object as Hex;
  const data = encodeDeployData({ abi: art.abi as Abi, bytecode, args: [WARS, USDT, agent, TEXTILE] });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", fileURLToPath(new URL("../../contracts/src", import.meta.url))], { encoding: "utf8" }).trim() !== "";

  for (const a of [WARS, USDT, ...TEXTILE]) assert.ok(((await reader.getCode({ address: a as Hex })) ?? "0x") !== "0x", `${a} no tiene código en mainnet`);
  await reader.call({ account: agent, data }); // reverts here if the constructor would revert
  const usdtGas = await reader.readContract({ address: USDT, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [agent] });
  console.log(`Simulación OK. Agente ${agent}, saldo USD₮ para gas: ${formatUnits(usdtGas, 6)}. Commit ${commit}, bytecode ${keccak256(bytecode)}`);

  if (!confirmed) {
    console.log("Dry run: no se mandó nada. Para desplegar: $env:CONFIRM_MAINNET=\"1\"; node scripts/deploy-mainnet.ts");
    return;
  }
  assert.ok(!dirty, "contracts/src tiene cambios sin commitear: desplegá desde un checkout limpio");
  assert.ok(usdtGas > 0n, "el agente no tiene USD₮ para pagar el gas");

  // Not wallet.deployContract: withAttribution doesn't wrap it, so the tx would go out untagged.
  const hash = await wallet.sendTransaction({ data, feeCurrency: USDT_ADAPTER });
  Object.assign(state, { factoryTx: hash, commit, bytecodeHash: keccak256(bytecode) });
  save(); // recorded before waiting: a crash from here on is recovered from the receipt, not redeployed
  await finish(hash);

  async function finish(hash: Hex) {
    const receipt = await reader.waitForTransactionReceipt({ hash, confirmations: 2 });
    assert.equal(receipt.status, "success", `deploy revertido ${hash}`);
    assert.ok(receipt.contractAddress, `la tx ${hash} no creó un contrato`);
    const tag = await verifyTx({ client: reader, hash });
    assert.ok(tag?.codes.includes(ATTRIBUTION_CODE), `la tx ${hash} no lleva el attribution tag`);
    const factory = receipt.contractAddress;
    const read = (functionName: "wars" | "usdt" | "agent") => reader.readContract({ address: factory, abi: factoryAbi, functionName });
    assert.equal(getAddress(await read("wars")), getAddress(WARS), "la factory desplegada no apunta al wARS esperado");
    assert.equal(getAddress(await read("usdt")), getAddress(USDT), "la factory desplegada no apunta al USD₮ esperado");
    assert.equal(getAddress(await read("agent")), getAddress(agent), "la factory desplegada no tiene a este agente");
    state.factory = factory;
    state.factoryBlock = receipt.blockNumber.toString();
    save();
    console.log(`✓ TildaiFactory en mainnet: ${factory} (bloque ${state.factoryBlock}, tx ${hash})`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
