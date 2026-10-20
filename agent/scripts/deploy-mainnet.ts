// Deploys TildaiFactory on Celo mainnet with the real wARS, USD₮ and Textile addresses. Gas in USD₮ (fee abstraction).
// Every tx is checked onchain for the attribution code. Idempotent and safe to rerun: before sending, the deploy nonce
// and the expected factory address are saved to deployments/celo.json, so a sendTransaction that throws after
// broadcasting (RPC timeout) is recovered by nonce instead of deploying a second factory.
// Usage (from agent/, after `forge build --force` in contracts/ from a clean checkout):
//   node scripts/deploy-mainnet.ts                     -> dry run: simulates the deploy with eth_call, sends nothing
//   PowerShell: $env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts   (cmd: set "CONFIRM_MAINNET=1")
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { verifyTx } from "@celo/attribution-tags";
import {
  encodeDeployData,
  formatUnits,
  getAddress,
  getContractAddress,
  hexToBytes,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { agentClients, ATTRIBUTION_CODE } from "../src/chain.ts";

// Sources: AGENTS.md (wARS), docs.textilecredit.com/protocol/address-book (Celo), docs.celo.org fee abstraction (adapter).
const WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const USDT_ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const TEXTILE = ["0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3", "0x01b006d5c687bde182aa36F542f1f014144742e2"];
const factoryAbi = parseAbi(["function wars() view returns (address)", "function usdt() view returns (address)", "function agent() view returns (address)"]);
const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

interface DeployState {
  chainId?: number;
  agent?: Address;
  factory?: Address;
  deployNonce?: number;
  expectedFactory?: Address;
  factoryTx?: Hex;
  factoryBlock?: string;
  commit?: string;
  bytecodeHash?: Hex;
}

type ImmutableRefs = Record<string, { start: number; length: number }[]>;

// Narrow shapes so tests can inject fakes; main() passes the real viem clients.
export interface DeployCtx {
  wallet: {
    account: { address: Address };
    sendTransaction: (args: { data: Hex; feeCurrency: Address; nonce?: number }) => Promise<Hex>;
  };
  reader: {
    getChainId: () => Promise<number>;
    getCode: (args: { address: Address }) => Promise<Hex | undefined>;
    getTransactionCount: (args: { address: Address; blockTag: "latest" | "pending" }) => Promise<number>;
    call: (args: { account: Address; data: Hex }) => Promise<unknown>;
    readContract: (args: { address: Address; abi: Abi; functionName: string; args?: unknown[] }) => Promise<unknown>;
    waitForTransactionReceipt: (args: {
      hash: Hex;
      confirmations?: number;
    }) => Promise<{ status: string; contractAddress: Address | null; blockNumber: bigint }>;
  };
  verifyTag: (hash: Hex) => Promise<{ codes: string[] } | null>;
  state: DeployState;
  save: () => void;
  artifact: { abi: Abi; bytecode: Hex; deployedBytecode: Hex; immutableReferences: ImmutableRefs };
  confirmed: boolean;
  commit: string;
  dirty: boolean;
}

// The artifact's deployedBytecode has zeros where immutables go; mask those ranges on both sides before comparing.
export function runtimeMatches(runtime: Hex, artifact: { deployedBytecode: Hex; immutableReferences: ImmutableRefs }) {
  const expected = hexToBytes(artifact.deployedBytecode);
  const onchain = hexToBytes(runtime);
  if (expected.length !== onchain.length) return false;
  for (const refs of Object.values(artifact.immutableReferences))
    for (const { start, length } of refs) {
      expected.fill(0, start, start + length);
      onchain.fill(0, start, start + length);
    }
  return toHex(expected) === toHex(onchain);
}

export async function deploy(ctx: DeployCtx) {
  const { wallet, reader, verifyTag, state, save, artifact, confirmed, commit, dirty } = ctx;
  const agent = wallet.account.address;
  assert.equal(getAddress(state.agent ?? agent), agent, "celo.json fue creado con otra wallet");
  state.agent ??= agent;

  if (state.factory) {
    console.log(`Ya hay una factory en mainnet: ${state.factory}. No hago nada.`);
    return;
  }
  assert.equal(await reader.getChainId(), 42220, "el RPC no es Celo mainnet");

  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [WARS, USDT, agent, TEXTILE] });
  const bytecodeHash = keccak256(artifact.bytecode);

  // Recovery: a previous run already reserved a nonce. Decide from the chain, never redeploy with another nonce.
  if (state.deployNonce !== undefined) {
    const expected = state.expectedFactory ?? (getContractAddress({ from: agent, nonce: BigInt(state.deployNonce) }) as Address);
    if (state.bytecodeHash) assert.equal(bytecodeHash, state.bytecodeHash, "el bytecode del artifact cambió desde el deploy guardado: revisar a mano");
    const code = (await reader.getCode({ address: expected })) ?? "0x";

    if (code !== "0x") {
      // The deploy landed but the run died before recording it (e.g. sendTransaction threw after broadcasting).
      console.log(`Hay un contrato en la dirección esperada ${expected}: lo recupero, no redespliego.`);
      if (!confirmed) {
        console.log('Dry run: no escribo nada. Para recuperarlo: $env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts');
        return;
      }
      assert.ok(runtimeMatches(code, artifact), `el contrato en ${expected} no es el TildaiFactory de este build: revisar a mano`);
      await checkFactory(expected);
      state.factory = expected;
      save();
      console.log(`✓ TildaiFactory recuperada en mainnet: ${expected}`);
      return;
    }

    const latest = await reader.getTransactionCount({ address: agent, blockTag: "latest" });
    assert.ok(
      latest <= state.deployNonce,
      `el nonce ${state.deployNonce} ya se usó pero no hay contrato en ${expected}: la tx se perdió o ese nonce se usó para otra cosa. Revisar a mano.`,
    );
    console.log(`El deploy con nonce ${state.deployNonce} no está en cadena y el nonce sigue libre: lo reenvío con el MISMO nonce.`);
    if (!confirmed) {
      console.log('Dry run: no reenvío nada. Para reenviar: $env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts');
      return;
    }
    const hash = await wallet.sendTransaction({ data, feeCurrency: USDT_ADAPTER, nonce: state.deployNonce });
    state.factoryTx = hash;
    save();
    await finish(hash);
    return;
  }

  // Legacy recovery: a run of the previous script saved only the tx hash. Recover from the receipt, never redeploy.
  if (state.factoryTx) {
    console.log(`Hay un deploy enviado sin registrar (${state.factoryTx}): busco su recibo, no redespliego.`);
    if (!confirmed) {
      console.log('Dry run: no escribo nada. Para recuperarlo: $env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts');
      return;
    }
    await finish(state.factoryTx);
    return;
  }

  for (const a of [WARS, USDT, ...TEXTILE]) assert.ok(((await reader.getCode({ address: a as Hex })) ?? "0x") !== "0x", `${a} no tiene código en mainnet`);
  await reader.call({ account: agent, data }); // reverts here if the constructor would revert
  const usdtGas = (await reader.readContract({ address: USDT, abi: balanceAbi, functionName: "balanceOf", args: [agent] })) as bigint;
  console.log(`Simulación OK. Agente ${agent}, saldo USD₮ para gas: ${formatUnits(usdtGas, 6)}. Commit ${commit}, bytecode ${bytecodeHash}`);

  if (!confirmed) {
    console.log('Dry run: no se mandó nada. Para desplegar: $env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts');
    return;
  }
  assert.ok(!dirty, "contracts/src tiene cambios sin commitear: desplegá desde un checkout limpio");
  assert.ok(usdtGas > 0n, "el agente no tiene USD₮ para pagar el gas");

  // Reserve the nonce and record it BEFORE sending: if sendTransaction throws after broadcasting, a rerun
  // recovers the factory at expectedFactory instead of deploying a second one with a fresh nonce.
  const deployNonce = await reader.getTransactionCount({ address: agent, blockTag: "pending" });
  const expectedFactory = getContractAddress({ from: agent, nonce: BigInt(deployNonce) }) as Address;
  Object.assign(state, { deployNonce, expectedFactory, commit, bytecodeHash });
  save();
  // Not wallet.deployContract: withAttribution doesn't wrap it, so the tx would go out untagged.
  const hash = await wallet.sendTransaction({ data, feeCurrency: USDT_ADAPTER, nonce: deployNonce });
  state.factoryTx = hash;
  save();
  await finish(hash);

  async function checkFactory(factory: Address) {
    const read = (functionName: "wars" | "usdt" | "agent") => reader.readContract({ address: factory, abi: factoryAbi, functionName });
    assert.equal(getAddress((await read("wars")) as Address), getAddress(WARS), "la factory desplegada no apunta al wARS esperado");
    assert.equal(getAddress((await read("usdt")) as Address), getAddress(USDT), "la factory desplegada no apunta al USD₮ esperado");
    assert.equal(getAddress((await read("agent")) as Address), agent, "la factory desplegada no tiene a este agente");
  }

  async function finish(hash: Hex) {
    let receipt;
    try {
      receipt = await reader.waitForTransactionReceipt({ hash, confirmations: 2 });
    } catch (e) {
      console.error(`No apareció el recibo de ${hash}. Si la tx no está en el explorador, revisá celo.json y volvé a correr.`);
      throw e;
    }
    assert.equal(receipt.status, "success", `deploy revertido ${hash}`);
    assert.ok(receipt.contractAddress, `la tx ${hash} no creó un contrato`);
    if (state.expectedFactory)
      assert.equal(getAddress(receipt.contractAddress), getAddress(state.expectedFactory), `la tx creó ${receipt.contractAddress}, no la esperada ${state.expectedFactory}`);
    const tag = await verifyTag(hash);
    assert.ok(tag?.codes.includes(ATTRIBUTION_CODE), `la tx ${hash} no lleva el attribution tag`);
    const factory = receipt.contractAddress;
    await checkFactory(factory);
    state.factory = factory;
    state.factoryBlock = receipt.blockNumber.toString();
    save();
    console.log(`✓ TildaiFactory en mainnet: ${factory} (bloque ${state.factoryBlock}, tx ${hash})`);
  }
}

async function main() {
  // Read before any RPC call; every exit below is a return, never process.exit with an open HTTP handle (crashes Node on Windows).
  const confirmed = process.env.CONFIRM_MAINNET === "1";
  process.loadEnvFile();
  const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  assert.ok(key, "falta AGENT_PRIVATE_KEY en agent/.env");
  const { wallet, reader } = agentClients("celo", key);
  const agent = wallet.account.address;

  const outFile = new URL("../../contracts/deployments/celo.json", import.meta.url);
  const state: DeployState = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { chainId: 42220, agent };
  const save = () => writeFileSync(outFile, JSON.stringify(state, null, 2) + "\n");
  if (state.factory) {
    console.log(`Ya hay una factory en mainnet: ${state.factory}. No hago nada.`);
    return;
  }

  const art = JSON.parse(readFileSync(new URL("../../contracts/out/TildaiFactory.sol/TildaiFactory.json", import.meta.url), "utf8"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", fileURLToPath(new URL("../../contracts/src", import.meta.url))], { encoding: "utf8" }).trim() !== "";

  await deploy({
    wallet: wallet as unknown as DeployCtx["wallet"],
    reader: reader as unknown as DeployCtx["reader"],
    verifyTag: (hash) => verifyTx({ client: reader, hash }),
    state,
    save,
    artifact: {
      abi: art.abi as Abi,
      bytecode: art.bytecode.object as Hex,
      deployedBytecode: art.deployedBytecode.object as Hex,
      immutableReferences: art.deployedBytecode.immutableReferences,
    },
    confirmed,
    commit,
    dirty,
  });
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
