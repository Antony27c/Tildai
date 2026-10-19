import { readFileSync } from 'node:fs';
import { WARS } from './indexer.ts';

export type Network = 'celo' | 'celo-sepolia';
export type IndexerConfig = { network: Network; chainId: number; rpcUrl: string; factory: string; wars: string; startBlock: bigint; storePath?: string };

const RPC = { celo: 'https://forno.celo.org', 'celo-sepolia': 'https://forno.celo-sepolia.celo-testnet.org' };
const need = (v: string | undefined, name: string) => {
  if (!v) throw new Error(`falta ${name}`);
  return v;
};

// shortcut: en Sepolia el bloque inicial es uno anterior al deploy de la factory, fijo a mano; leer el bloque de deploy del JSON cuando lo incluya.
const SEPOLIA_START = 39_096_000n;

// Celo Sepolia sale de contracts/deployments/celo-sepolia.json; mainnet exige factory y bloque por entorno.
export function loadConfig(env: Record<string, string | undefined> = process.env): IndexerConfig {
  const network = (env.TILDAI_NETWORK ?? 'celo') as Network;
  const rpcUrl = env.RPC_URL ?? RPC[network];
  if (!rpcUrl) throw new Error(`red desconocida: ${network}`);
  if (network === 'celo-sepolia') {
    const d = JSON.parse(readFileSync(new URL('../../contracts/deployments/celo-sepolia.json', import.meta.url), 'utf8'));
    return {
      network, chainId: 11142220, rpcUrl, storePath: env.TILDAI_STORE_PATH,
      factory: env.TILDAI_FACTORY ?? d.factory,
      wars: env.TILDAI_WARS ?? d.wars,
      startBlock: env.TILDAI_FROM_BLOCK ? BigInt(env.TILDAI_FROM_BLOCK) : SEPOLIA_START,
    };
  }
  if (network !== 'celo') throw new Error(`red desconocida: ${network}`);
  return {
    network, chainId: 42220, rpcUrl, storePath: env.TILDAI_STORE_PATH,
    factory: need(env.TILDAI_FACTORY, 'TILDAI_FACTORY'),
    wars: env.TILDAI_WARS ?? WARS,
    startBlock: BigInt(need(env.TILDAI_FROM_BLOCK, 'TILDAI_FROM_BLOCK')),
  };
}
