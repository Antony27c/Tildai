import { test } from "node:test";
import assert from "node:assert/strict";
import { fromDataSuffix } from "@celo/attribution-tags";
import { parseAbi, toHex, type Hex } from "viem";
import { parseTransaction } from "viem/celo";

import { agentClients, ATTRIBUTION_CODE } from "../src/chain.ts";

// No network: a fetch stub answers the JSON-RPC calls viem's http transport makes and keeps every raw tx.
const TEST_KEY = `0x${"aa".repeat(32)}` as Hex;
const USDT_FEE_ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const TARGET = "0x5555555555555555555555555555555555555555";

function stubRpc(chainId: number) {
  const raws: Hex[] = [];
  const answer = (method: string, params: unknown[]): unknown => {
    switch (method) {
      case "eth_chainId":
        return toHex(chainId);
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_estimateGas":
        return toHex(100_000);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return toHex(1_000_000_000);
      case "eth_getBlockByNumber":
        return { number: "0x1", hash: `0x${"11".repeat(32)}`, baseFeePerGas: toHex(1_000_000_000), timestamp: "0x1", transactions: [] };
      case "eth_sendRawTransaction":
        raws.push(params[0] as Hex);
        return `0x${"22".repeat(32)}`;
      default:
        throw new Error(`RPC no esperado en el test: ${method}`);
    }
  };
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "null");
    const one = (r: { id: number; method: string; params?: unknown[] }) => ({ jsonrpc: "2.0", id: r.id, result: answer(r.method, r.params ?? []) });
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { raws, restore: () => (globalThis.fetch = original) };
}

const codesOf = (raw: Hex) => fromDataSuffix(parseTransaction(raw).data ?? "0x")?.codes;

test("agentClients pone el attribution tag en writeContract y en sendTransaction con feeCurrency (CIP-64)", async () => {
  const rpc = stubRpc(42220);
  try {
    const { wallet } = agentClients("celo", TEST_KEY);
    await wallet.writeContract({
      address: TARGET,
      abi: parseAbi(["function allocate(bytes32 opId, uint8 to, uint256 amount)"]),
      functionName: "allocate",
      args: [`0x${"33".repeat(32)}`, 1, 1n],
      feeCurrency: USDT_FEE_ADAPTER,
    });
    await wallet.sendTransaction({ to: TARGET, data: "0x1234", feeCurrency: USDT_FEE_ADAPTER });
  } finally {
    rpc.restore();
  }
  assert.equal(rpc.raws.length, 2);
  for (const raw of rpc.raws) {
    const tx = parseTransaction(raw);
    assert.equal(tx.type, "cip64", "la tx con feeCurrency tiene que ser CIP-64");
    assert.equal(tx.feeCurrency?.toLowerCase(), USDT_FEE_ADAPTER);
    assert.deepEqual(codesOf(raw), [ATTRIBUTION_CODE]);
  }
});

test("agentClients pone el attribution tag en Sepolia sin feeCurrency", async () => {
  const rpc = stubRpc(11142220);
  try {
    await agentClients("celoSepolia", TEST_KEY).wallet.sendTransaction({ to: TARGET, data: "0x1234" });
  } finally {
    rpc.restore();
  }
  assert.equal(rpc.raws.length, 1);
  assert.deepEqual(codesOf(rpc.raws[0]), [ATTRIBUTION_CODE]);
});
