import { readFileSync } from 'node:fs';
import { WARS } from './indexer.ts';

export type Network = 'celo' | 'celo-sepolia';
export type IndexerConfig = { network: Network; chainId: number; rpcUrl: string; archiveRpcUrl?: string; factory: string; wars: string; startBlock: bigint; storePath?: string };

const RPC = { celo: 'https://forno.celo.org', 'celo-sepolia': 'https://forno.celo-sepolia.celo-testnet.org' };
const ADDR = /^0x[0-9a-fA-F]{40}$/;

// Los errores nombran la variable, nunca el valor (podría ser secreto).
const need = (v: string | undefined, name: string) => {
  if (!v) throw new Error(`falta ${name}`);
  return v;
};
const addr = (v: string, name: string) => {
  if (!ADDR.test(v)) throw new Error(`${name} inválido`);
  return v;
};
const block = (v: string, name: string) => {
  if (!/^\d+$/.test(v)) throw new Error(`${name} inválido`);
  return BigInt(v);
};
const rpc = (v: string | undefined, name: string) => {
  if (v == null) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' || u.protocol === 'https:') return v;
  } catch { /* cae al throw */ }
  throw new Error(`${name} inválido`);
};

// shortcut: en Sepolia el bloque inicial es uno anterior al deploy de la factory, fijo a mano; leer el bloque de deploy del JSON cuando lo incluya.
const SEPOLIA_START = 39_096_000n;

// Celo Sepolia sale de contracts/deployments/celo-sepolia.json; mainnet exige factory y bloque por entorno.
export function loadConfig(env: Record<string, string | undefined> = process.env): IndexerConfig {
  const network = env.TILDAI_NETWORK ?? 'celo';
  if (network !== 'celo' && network !== 'celo-sepolia') throw new Error('TILDAI_NETWORK inválido');
  const rpcUrl = rpc(env.RPC_URL, 'RPC_URL') ?? RPC[network];
  const archiveRpcUrl = rpc(env.TILDAI_ARCHIVE_RPC_URL, 'TILDAI_ARCHIVE_RPC_URL');
  if (network === 'celo-sepolia') {
    const d = JSON.parse(readFileSync(new URL('../../contracts/deployments/celo-sepolia.json', import.meta.url), 'utf8'));
    return {
      network, chainId: 11142220, rpcUrl, archiveRpcUrl, storePath: env.TILDAI_STORE_PATH,
      factory: env.TILDAI_FACTORY ? addr(env.TILDAI_FACTORY, 'TILDAI_FACTORY') : d.factory,
      wars: env.TILDAI_WARS ? addr(env.TILDAI_WARS, 'TILDAI_WARS') : d.wars,
      startBlock: env.TILDAI_FROM_BLOCK ? block(env.TILDAI_FROM_BLOCK, 'TILDAI_FROM_BLOCK') : SEPOLIA_START,
    };
  }
  return {
    network, chainId: 42220, rpcUrl, archiveRpcUrl, storePath: env.TILDAI_STORE_PATH,
    factory: addr(need(env.TILDAI_FACTORY, 'TILDAI_FACTORY'), 'TILDAI_FACTORY'),
    wars: addr(env.TILDAI_WARS ?? WARS, 'TILDAI_WARS'),
    startBlock: block(need(env.TILDAI_FROM_BLOCK, 'TILDAI_FROM_BLOCK'), 'TILDAI_FROM_BLOCK'),
  };
}
