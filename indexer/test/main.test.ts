import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ChainReader } from '../src/indexer.ts';
import { start } from '../src/main.ts';
import { loadStore } from '../src/persist.ts';

const V1 = '0x00000000000000000000000000000000000000a1';
const TOKEN32 = 'x'.repeat(32);
const tmp = async () => join(await mkdtemp(join(tmpdir(), 'tildai-')), 'store.json');
const client: ChainReader = {
  getBlockNumber: async () => 100n,
  getBlock: async () => ({ timestamp: 1700000000n }),
  getLogs: async () => [],
};
const env = (over: Record<string, string | undefined>) => ({
  TILDAI_INDEXER_TOKEN: TOKEN32,
  TILDAI_NETWORK: 'celo-sepolia',
  TILDAI_STORE_PATH: 'x.json',
  TILDAI_PORT: '0',
  ...over,
});

test('arranque: variable obligatoria ausente o inválida falla nombrándola', async () => {
  await assert.rejects(start(env({ TILDAI_INDEXER_TOKEN: undefined })), /TILDAI_INDEXER_TOKEN/);
  await assert.rejects(start(env({ TILDAI_INDEXER_TOKEN: 'x'.repeat(31) })), /TILDAI_INDEXER_TOKEN/);
  await assert.rejects(start(env({ TILDAI_STORE_PATH: undefined })), /TILDAI_STORE_PATH/);
  await assert.rejects(start(env({ TILDAI_NETWORK: 'polygon' })), /TILDAI_NETWORK/);
  await assert.rejects(start(env({ RPC_URL: 'no-es-url' })), /RPC_URL/);
  await assert.rejects(start(env({ TILDAI_ARCHIVE_RPC_URL: 'no-es-url' })), /TILDAI_ARCHIVE_RPC_URL/);
  await assert.rejects(start(env({ TILDAI_FACTORY: '0x123' })), /TILDAI_FACTORY/);
  await assert.rejects(start(env({ TILDAI_WARS: '0xzz' })), /TILDAI_WARS/);
  await assert.rejects(start(env({ TILDAI_FROM_BLOCK: 'abc' })), /TILDAI_FROM_BLOCK/);
  await assert.rejects(start(env({ TILDAI_POLL_SECONDS: '0' })), /TILDAI_POLL_SECONDS/);
  await assert.rejects(start(env({ TILDAI_POLL_SECONDS: '1.5' })), /TILDAI_POLL_SECONDS/);
  await assert.rejects(start(env({ TILDAI_PORT: 'manzana' })), /TILDAI_PORT/);
  await assert.rejects(start(env({ TILDAI_PORT: '70000' })), /TILDAI_PORT/);
  // mainnet exige factory y bloque inicial
  await assert.rejects(start(env({ TILDAI_NETWORK: 'celo' })), /TILDAI_FACTORY/);
  await assert.rejects(start(env({ TILDAI_NETWORK: 'celo', TILDAI_FACTORY: V1 })), /TILDAI_FROM_BLOCK/);
  await assert.rejects(start(env({ TILDAI_NETWORK: 'celo', TILDAI_FACTORY: V1, TILDAI_FROM_BLOCK: 'abc' })), /TILDAI_FROM_BLOCK/);
});

test('variables numéricas vacías usan el default, no un puerto al azar', async () => {
  try {
    const s = await start(env({ TILDAI_STORE_PATH: await tmp(), TILDAI_PORT: '', TILDAI_POLL_SECONDS: '', TILDAI_HOST: '' }), client);
    assert.equal((s.server.address() as AddressInfo).port, 8787);
    await s.stop();
  } catch (e) {
    // Si 8787 está ocupado, el EADDRINUSE igual prueba que resolvió el default.
    assert.match((e as Error).message, /EADDRINUSE.+8787/);
  }
});

test('stop es idempotente: la segunda señal devuelve la misma promesa', async () => {
  const path = await tmp();
  const s = await start(env({ TILDAI_STORE_PATH: path, TILDAI_POLL_SECONDS: '60' }), client);
  s.store.vaults.set(V1, '0x00000000000000000000000000000000000000c1');
  const p1 = s.stop();
  const p2 = s.stop();
  assert.equal(p1, p2);
  await p1;
  assert.equal((await loadStore(path)).vaults.get(V1), '0x00000000000000000000000000000000000000c1');
});

test('apagado prolijo: cierra el server, no espera el sleep del watch y persiste el store', async () => {
  const path = await tmp();
  const s = await start(env({ TILDAI_STORE_PATH: path, TILDAI_POLL_SECONDS: '60' }), client);
  const port = (s.server.address() as AddressInfo).port;
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);

  // Cambio en memoria que ningún save previo conoce: el apagado lo tiene que guardar.
  s.store.vaults.set(V1, '0x00000000000000000000000000000000000000c1');
  const t0 = Date.now();
  await s.stop(); // el watch dormía 60 s entre polls: si no corta el sleep, esto tarda un minuto
  assert.ok(Date.now() - t0 < 10_000);

  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  const b = await loadStore(path);
  assert.equal(b.vaults.get(V1), '0x00000000000000000000000000000000000000c1');
});
