import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import type { ChainReader } from './indexer.ts';
import type { IndexerConfig } from './config.ts';

export function viemReader(c: Pick<IndexerConfig, 'network' | 'rpcUrl'>): ChainReader {
  const chain = c.network === 'celo' ? celo : celoSepolia;
  return createPublicClient({ chain, transport: http(c.rpcUrl) }) as unknown as ChainReader;
}
