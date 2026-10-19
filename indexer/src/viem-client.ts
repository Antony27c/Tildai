import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import type { ChainReader } from './indexer.ts';

export function viemReader(rpcUrl: string): ChainReader {
  return createPublicClient({ chain: celo, transport: http(rpcUrl) }) as unknown as ChainReader;
}
