import { parseAbi, type Address } from "viem";

import { dayIndex } from "./sales.ts";
import type { Transfer, Vault } from "./vault.ts";

// Minimal hand-written ABI: contracts/out is gitignored.
export const vaultAbi = parseAbi([
  "function wars() view returns (address)",
  "function operating() view returns (uint256)",
  "function savings() view returns (uint256)",
  "function taxes() view returns (uint256)",
  "function spentDay() view returns (uint256)",
  "function spentToday() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
  "function maxRate() view returns (uint256)",
  "function paused() view returns (bool)",
  "function maxSwap() view returns (uint256)",
  "function canSwapSavings() view returns (bool)",
  "function canSwapTaxes() view returns (bool)",
  "function payoutWallet() view returns (address)",
  "function usedOp(bytes32) view returns (bool)",
  "function allocate(bytes32 opId, uint8 to, uint256 amount)",
  "function withdraw(bytes32 opId, uint256 amount)",
  "function swap(bytes32 opId, uint8 from, address spender, address target, bytes data, uint256 amountIn, uint256 minOut)",
]);

const transferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])[0];

export const factoryAbi = parseAbi([
  "function createVault(address owner, address payoutWallet, uint256 dailyCap, uint256 maxRate, uint256 maxSwap) returns (address)",
  "function isVault(address) view returns (bool)",
  "event VaultCreated(address indexed vault, address indexed owner)",
]);
export const vaultCreatedEvent = factoryAbi.find((x) => x.type === "event" && x.name === "VaultCreated")!;

// Loose on purpose: real viem clients and test fakes both fit.
export type ChainReader = {
  readContract(args: any): Promise<any>;
  getBlockNumber(): Promise<bigint>;
  getLogs(args: any): Promise<any[]>;
  getBlock(args: any): Promise<{ timestamp: bigint }>;
  getTransactionReceipt?(args: any): Promise<{ status: string; logs?: any[] } | null>;
  getTransaction?(args: any): Promise<{ nonce?: number; blockNumber?: bigint | null } | null>;
  getTransactionCount?(args: any): Promise<number>;
};

export type Balances = {
  operating: bigint;
  savings: bigint;
  taxes: bigint;
  /** wARS (wei) the agent already spent today (Argentine day); 0 if the contract's counter is from an older day. */
  spentToday: bigint;
  dailyCap: bigint;
  maxRate: bigint;
  paused: boolean;
};

export class ChainVault implements Vault {
  address: Address;
  private reader: ChainReader;
  private fromBlock: bigint;
  private confirmations: bigint;
  private chunk: bigint;
  private now: () => number;
  private wars?: Address;

  // shortcut: fromBlock is required (the vault's creation block) and logs are read in fixed chunks on every call; add a cursor/indexer when volume grows.
  constructor(o: { address: Address; reader: ChainReader; fromBlock: bigint; confirmations?: number; chunk?: bigint; now?: () => number }) {
    this.address = o.address;
    this.reader = o.reader;
    this.fromBlock = o.fromBlock;
    this.confirmations = BigInt(o.confirmations ?? 2); // forno balances across nodes; 1 block can vanish from a lagging node
    this.chunk = o.chunk ?? 10_000n;
    this.now = o.now ?? Date.now;
  }

  private read(functionName: string) {
    return this.reader.readContract({ address: this.address, abi: vaultAbi, functionName });
  }

  /** Confirmed only after N confirmations. Any RPC error propagates, so SalesBook leaves sales pending. */
  async transfers(): Promise<Transfer[]> {
    this.wars ??= (await this.read("wars")) as Address;
    const latest = await this.reader.getBlockNumber();
    const logs: any[] = [];
    for (let from = this.fromBlock; from <= latest; from += this.chunk) {
      const toBlock = from + this.chunk - 1n < latest ? from + this.chunk - 1n : latest;
      logs.push(...(await this.reader.getLogs({ address: this.wars, event: transferEvent, args: { to: this.address }, fromBlock: from, toBlock })));
    }
    const stamps = new Map<bigint, number>();
    const out: Transfer[] = [];
    for (const l of logs) {
      if (l.blockNumber == null || l.logIndex == null || !l.transactionHash) continue; // pending logs have no position yet
      if (!stamps.has(l.blockNumber)) stamps.set(l.blockNumber, Number((await this.reader.getBlock({ blockNumber: l.blockNumber })).timestamp) * 1000);
      out.push({
        id: `${l.transactionHash}:${l.logIndex}`,
        from: l.args.from,
        amount: l.args.value,
        timestamp: stamps.get(l.blockNumber)!,
        confirmed: latest - l.blockNumber + 1n >= this.confirmations,
      });
    }
    return out;
  }

  async balances(): Promise<Balances> {
    const [operating, savings, taxes, spentDay, spentToday, dailyCap, maxRate, paused] = await Promise.all(
      ["operating", "savings", "taxes", "spentDay", "spentToday", "dailyCap", "maxRate", "paused"].map((f) => this.read(f)),
    );
    return {
      operating, savings, taxes, dailyCap, maxRate, paused,
      spentToday: spentDay === BigInt(dayIndex(this.now())) ? spentToday : 0n,
    };
  }

  async payoutWallet(): Promise<Address> {
    return (await this.read("payoutWallet")) as Address;
  }
}
