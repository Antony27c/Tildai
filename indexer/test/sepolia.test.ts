import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndexer, Store, parseWars } from '../src/indexer.ts';
import { loadConfig } from '../src/config.ts';
import { viemReader } from '../src/viem-client.ts';

const SMOKE_VAULT = '0x498450fe2b46f6b380857b2de20df7d52d17f18b';

// Solo lectura contra Celo Sepolia. Sin red: TILDAI_OFFLINE=1 lo saltea.
test('Sepolia: descubre el smokeVault desde la factory y encuentra el Transfer de 10.000 wARS', { skip: !!process.env.TILDAI_OFFLINE, timeout: 120_000 }, async () => {
  const cfg = loadConfig({ TILDAI_NETWORK: 'celo-sepolia' });
  assert.equal(cfg.chainId, 11142220);
  const store = new Store();
  const idx = createIndexer({ client: viemReader(cfg), store, factory: cfg.factory, token: cfg.wars, startBlock: cfg.startBlock });
  const r = await idx.pollOnce();
  assert.equal(r.ok, true, r.ok ? '' : String((r as { error: unknown }).error));
  assert.ok(store.vaults.has(SMOKE_VAULT));
  const p = [...store.payments.values()].find((x) => x.vault === SMOKE_VAULT && x.amount === parseWars('10000'));
  assert.ok(p, 'falta el Transfer de 10.000 wARS');
  assert.equal(p.block, 39096539n);
});
