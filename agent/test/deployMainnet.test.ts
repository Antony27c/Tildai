import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, getContractAddress, hexToBytes, keccak256, toHex, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { deploy, runtimeMatches, type DeployCtx } from "../scripts/deploy-mainnet.ts";
import { ATTRIBUTION_CODE } from "../src/chain.ts";

// All fakes: no network, no disk. deploy() gets everything injected through DeployCtx.
const AGENT = privateKeyToAccount(`0x${"aa".repeat(32)}`).address;
const WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const TEXTILE = ["0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3", "0x01b006d5c687bde182aa36F542f1f014144742e2"];
const HASH = `0x${"22".repeat(32)}` as Hex;

// Fake artifact: 100 bytes of runtime where bytes 10..42 are an immutable (zeroed in the artifact, set onchain).
const DEPLOYED = toHex(new Uint8Array(100).fill(0xaa));
const ARTIFACT = {
  abi: [
    {
      type: "constructor",
      inputs: [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address[]" }],
    },
  ] as Abi,
  bytecode: "0x6000" as Hex,
  deployedBytecode: DEPLOYED,
  immutableReferences: { "1": [{ start: 10, length: 32 }] },
};

// The runtime as it would sit onchain: same code, immutable range filled in.
const ONCHAIN_RUNTIME = toHex(hexToBytes(DEPLOYED).map((b, i) => (i >= 10 && i < 42 ? 0xbb : b)));

function fakeWallet(send: (args: { nonce?: number }) => Promise<Hex> = async () => HASH) {
  const sent: { nonce?: number }[] = [];
  return {
    sent,
    account: { address: AGENT },
    sendTransaction: async (args: { nonce?: number }) => {
      sent.push(args);
      return send(args);
    },
  };
}

type Receipt = { status: string; contractAddress: Address | null; blockNumber: bigint };

function fakeReader(
  opts: {
    codeAt?: Record<string, Hex>;
    counts?: { pending?: number; latest?: number };
    nonceCountAt?: (blockNumber: bigint) => number;
    blockNumber?: bigint;
    txsAt?: Record<string, { hash: Hex; from: Address; to: Address | null; nonce: number }[]>;
    receipts?: Record<string, Receipt>;
    receipt?: Receipt;
    receiptError?: Error;
    historyError?: Error;
  } = {},
) {
  const tokens = new Set([WARS, USDT, ...TEXTILE].map((a) => getAddress(a)));
  const knownReads: Record<string, unknown> = { wars: WARS, usdt: USDT, agent: AGENT, balanceOf: 10_000_000n };
  return {
    getChainId: async () => 42220,
    getCode: async ({ address }: { address: Address }) => opts.codeAt?.[getAddress(address)] ?? (tokens.has(getAddress(address)) ? "0x6001" : "0x"),
    getTransactionCount: async ({ blockTag, blockNumber }: { blockTag?: "latest" | "pending"; blockNumber?: bigint }) => {
      if (blockNumber !== undefined) {
        if (opts.historyError) throw opts.historyError;
        return opts.nonceCountAt?.(blockNumber) ?? 0;
      }
      return blockTag === "pending" ? (opts.counts?.pending ?? 0) : (opts.counts?.latest ?? 0);
    },
    getBlockNumber: async () => opts.blockNumber ?? 100n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ transactions: opts.txsAt?.[blockNumber.toString()] ?? [] }),
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => opts.receipts?.[hash] ?? null,
    call: async () => ({ data: "0x" }),
    readContract: async ({ functionName }: { functionName: string }) => knownReads[functionName],
    waitForTransactionReceipt: async () => {
      if (opts.receiptError) throw opts.receiptError;
      return opts.receipt;
    },
  };
}

function ctx(overrides: Partial<DeployCtx> = {}) {
  const saves: DeployCtx["state"][] = [];
  const state: DeployCtx["state"] = { chainId: 42220, agent: AGENT, ...overrides.state };
  const wallet = overrides.wallet ?? fakeWallet();
  const reader = overrides.reader ?? fakeReader();
  const c: DeployCtx = {
    wallet,
    reader,
    verifyTag: async () => ({ codes: [ATTRIBUTION_CODE] }),
    state,
    save: () => saves.push({ ...state }),
    artifact: ARTIFACT,
    confirmed: true,
    commit: "abc123",
    dirty: false,
    ...overrides,
    state,
    wallet,
    reader,
  };
  return { saves, ctx: c };
}

test("runtimeMatches: ignora immutables, rechaza otro bytecode", () => {
  assert.ok(runtimeMatches(ONCHAIN_RUNTIME, ARTIFACT));
  const other = hexToBytes(ONCHAIN_RUNTIME);
  other[50] = 0xff;
  assert.ok(!runtimeMatches(toHex(other), ARTIFACT));
  assert.ok(!runtimeMatches("0x6001", ARTIFACT));
});

test("recupera la factory si ya hay código en expectedFactory", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const wallet = fakeWallet();
  const { ctx: c, saves } = ctx({
    wallet,
    state: { deployNonce: 3, expectedFactory: expected, factoryTx: HASH, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({
      codeAt: { [getAddress(expected)]: ONCHAIN_RUNTIME },
      receipts: { [HASH]: { status: "success", contractAddress: expected, blockNumber: 50n } },
    }),
  });
  await deploy(c);
  assert.equal(c.state.factory, expected);
  assert.equal(c.state.factoryBlock, "50");
  assert.equal(wallet.sent.length, 0, "no tiene que mandar otra tx");
  assert.ok(saves.at(-1)?.factory);
});

test("recupera sin factoryTx: busca la tx por nonce, verifica su tag y anota el bloque", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const DEPLOY_HASH = `0x${"77".repeat(32)}` as Hex;
  const tagged: Hex[] = [];
  const { ctx: c } = ctx({
    verifyTag: async (hash: Hex) => (tagged.push(hash), { codes: [ATTRIBUTION_CODE] }),
    state: { deployNonce: 3, expectedFactory: expected, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({
      codeAt: { [getAddress(expected)]: ONCHAIN_RUNTIME },
      blockNumber: 100n,
      nonceCountAt: (b) => (b >= 50n ? 4 : 3), // el nonce 3 se gastó en el bloque 50
      txsAt: { "50": [{ hash: DEPLOY_HASH, from: AGENT, to: null, nonce: 3 }] },
      receipts: { [DEPLOY_HASH]: { status: "success", contractAddress: expected, blockNumber: 50n } },
    }),
  });
  await deploy(c);
  assert.equal(c.state.factory, expected);
  assert.equal(c.state.factoryBlock, "50");
  assert.deepEqual(tagged, [DEPLOY_HASH]);
});

test("no da por buena una factory recuperada si la tx no lleva el tag", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const { ctx: c } = ctx({
    verifyTag: async () => ({ codes: ["otro_codigo"] }),
    state: { deployNonce: 3, expectedFactory: expected, factoryTx: HASH, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({
      codeAt: { [getAddress(expected)]: ONCHAIN_RUNTIME },
      receipts: { [HASH]: { status: "success", contractAddress: expected, blockNumber: 50n } },
    }),
  });
  await assert.rejects(deploy(c), /tag/);
  assert.equal(c.state.factory, undefined);
});

test("no da por buena una factory si no aparece la tx que la creó", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const { ctx: c } = ctx({
    state: { deployNonce: 3, expectedFactory: expected, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({
      codeAt: { [getAddress(expected)]: ONCHAIN_RUNTIME },
      blockNumber: 100n,
      nonceCountAt: (b) => (b >= 50n ? 4 : 3),
      txsAt: { "50": [] }, // el bloque no tiene la create tx
    }),
  });
  await assert.rejects(deploy(c), /no encontré la tx.*revisar a mano/i);
  assert.equal(c.state.factory, undefined);
});

test("con factoryTx guardado y sin código espera su recibo, no reenvía", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const wallet = fakeWallet();
  const { ctx: c } = ctx({
    wallet,
    state: { deployNonce: 3, expectedFactory: expected, factoryTx: HASH, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({ receipt: { status: "success", contractAddress: expected, blockNumber: 51n } }),
  });
  await deploy(c);
  assert.equal(wallet.sent.length, 0);
  assert.equal(c.state.factory, expected);
  assert.equal(c.state.factoryBlock, "51");
});

test("si el recibo de factoryTx no aparece, corta con aviso y no reenvía", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const wallet = fakeWallet();
  const errors: string[] = [];
  const origError = console.error;
  console.error = (m: unknown) => errors.push(String(m));
  const { ctx: c } = ctx({
    wallet,
    state: { deployNonce: 3, expectedFactory: expected, factoryTx: HASH, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({ receiptError: new Error("Timed out while waiting for transaction") }),
  });
  try {
    await assert.rejects(deploy(c), /Timed out/);
  } finally {
    console.error = origError;
  }
  assert.equal(wallet.sent.length, 0);
  assert.equal(c.state.factory, undefined);
  assert.match(errors.join("\n"), /borrá factoryTx de celo\.json.*mismo nonce/i);
});

test("si el RPC no sirve estado histórico, sugiere completar factoryTx a mano", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const { ctx: c } = ctx({
    state: { deployNonce: 3, expectedFactory: expected, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({
      codeAt: { [getAddress(expected)]: ONCHAIN_RUNTIME },
      historyError: new Error("block is more than 10064 blocks behind head"),
    }),
  });
  await assert.rejects(deploy(c), /factoryTx a mano en celo\.json/i);
  assert.equal(c.state.factory, undefined);
});

test("dry run solo informa la recuperación, no escribe", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const { ctx: c, saves } = ctx({
    confirmed: false,
    state: { deployNonce: 3, expectedFactory: expected, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({ codeAt: { [getAddress(expected)]: ONCHAIN_RUNTIME } }),
  });
  await deploy(c);
  assert.equal(c.state.factory, undefined);
  assert.equal(saves.length, 0);
});

test("frena si el nonce avanzó pero no hay contrato", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const wallet = fakeWallet();
  const { ctx: c } = ctx({
    wallet,
    state: { deployNonce: 3, expectedFactory: expected, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({ counts: { latest: 4 } }), // getCode(expected) -> "0x"
  });
  await assert.rejects(deploy(c), /nonce 3.*revisar a mano/i);
  assert.equal(wallet.sent.length, 0);
});

test("reenvía con el MISMO nonce si el nonce no avanzó", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 3n });
  const wallet = fakeWallet();
  const { ctx: c } = ctx({
    wallet,
    state: { deployNonce: 3, expectedFactory: expected, bytecodeHash: keccak256(ARTIFACT.bytecode) },
    reader: fakeReader({ counts: { latest: 3 }, receipt: { status: "success", contractAddress: expected, blockNumber: 99n } }),
  });
  await deploy(c);
  assert.equal(wallet.sent.length, 1);
  assert.equal(wallet.sent[0].nonce, 3);
  assert.equal(c.state.factory, expected);
  assert.equal(c.state.factoryTx, HASH);
});

test("un deploy nuevo guarda deployNonce y expectedFactory antes de enviar, aunque sendTransaction tire", async () => {
  const wallet = fakeWallet(async () => {
    throw new Error("RPC timeout después de difundir");
  });
  const { ctx: c, saves } = ctx({ wallet, reader: fakeReader({ counts: { pending: 7 } }) });
  await assert.rejects(deploy(c), /timeout/);
  assert.equal(wallet.sent.length, 1);
  assert.equal(wallet.sent[0].nonce, 7);
  assert.equal(saves.length, 1, "guardó antes de enviar y nada más");
  assert.equal(saves[0].deployNonce, 7);
  assert.equal(saves[0].expectedFactory, getContractAddress({ from: AGENT, nonce: 7n }));
  assert.equal(saves[0].bytecodeHash, keccak256(ARTIFACT.bytecode));
  assert.equal(saves[0].factoryTx, undefined, "sin hash: se recupera por nonce, no por recibo");
});

test("deploy nuevo feliz: manda con el nonce reservado y verifica el tag", async () => {
  const expected = getContractAddress({ from: AGENT, nonce: 7n });
  const tagged: Hex[] = [];
  const wallet = fakeWallet();
  const { ctx: c, saves } = ctx({
    wallet,
    verifyTag: async (hash: Hex) => (tagged.push(hash), { codes: [ATTRIBUTION_CODE] }),
    reader: fakeReader({ counts: { pending: 7 }, receipt: { status: "success", contractAddress: expected, blockNumber: 42n } }),
  });
  await deploy(c);
  assert.equal(wallet.sent[0].nonce, 7);
  assert.deepEqual(tagged, [HASH]);
  assert.equal(c.state.factory, expected);
  assert.equal(c.state.factoryBlock, "42");
  assert.equal(saves.length, 3, "nonce antes de enviar, factoryTx al volver, factory al confirmar");
  assert.equal(saves[2].factory, expected);
});

test("rechaza un celo.json de otra wallet", async () => {
  const { ctx: c } = ctx({ state: { agent: "0x0000000000000000000000000000000000000001" as Address } });
  await assert.rejects(deploy(c), /otra wallet/);
});
