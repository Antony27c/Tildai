import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createIndexer, Store, WARS, vaultCreatedEvent, type ChainReader, type Log } from '../src/indexer.ts';
import { createApp, MAX_BODY } from '../src/server.ts';
import { start } from '../src/main.ts';

const F = '0x00000000000000000000000000000000000000f0';
const V1 = '0x00000000000000000000000000000000000000a1';
const TOKEN = 'token-de-prueba-largo';
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

const chain = {
  head: 100n,
  fail: false,
  logs: [{ address: F, blockNumber: 5n, transactionHash: h(99), logIndex: 0, args: { vault: V1, owner: '0x00000000000000000000000000000000000000c1' } }] as Log[],
};
const client: ChainReader = {
  async getBlockNumber() { if (chain.fail) throw new Error('rpc down'); return chain.head; },
  async getLogs(p) {
    return chain.logs.filter((l) => l.address === p.address && (p.event === vaultCreatedEvent ? l.args.vault : p.args!.to.includes(l.args.to!)) && l.blockNumber! >= p.fromBlock && l.blockNumber! <= p.toBlock);
  },
};

const store = new Store();
const indexer = createIndexer({ client, store, factory: F, startBlock: 1n, confirmations: 2n, rescan: 0n, retries: 0, onError: () => {} });
const server = createApp({ indexer, store, token: TOKEN, onError: () => {} });
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const call = async (method: string, path: string, body?: unknown, auth: string | null = `Bearer ${TOKEN}`) => {
  const r = await fetch(base + path, {
    method,
    headers: { ...(auth && { authorization: auth }), 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
};

test('health no pide auth', async () => {
  assert.equal((await indexer.pollOnce()).ok, true);
  const r = await call('GET', '/health', undefined, null);
  assert.deepEqual([r.status, r.body], [200, { cursor: '99', vaults: 1 }]);
});

test('auth: falta, mala y buena', async () => {
  assert.equal((await call('GET', '/sales/x', undefined, null)).status, 401);
  assert.equal((await call('GET', '/sales/x', undefined, 'Bearer otro-token-distinto')).status, 401);
  assert.equal((await call('GET', '/sales/x', undefined, TOKEN)).status, 401);
  assert.equal((await call('POST', '/sales', {}, 'Bearer ')).status, 401);
  assert.equal((await call('GET', '/sales/x')).status, 404);
});

test('POST /sales: 201, 409 y 400', async () => {
  const ok = await call('POST', '/sales', { id: 'a1', vault: V1.toUpperCase().replace('0X', '0x'), amount: '8500000000000000000000' });
  assert.deepEqual([ok.status, ok.body], [201, { id: 'a1', vault: V1, amount: '8500000000000000000000', status: 'pendiente', createdBlock: '100' }]);
  assert.equal((await call('POST', '/sales', { id: 'a1', vault: V1, amount: '1' })).status, 409);
  const bad = [
    { id: 'b', vault: '0x00000000000000000000000000000000000000ee', amount: '1' },
    { id: 'b', vault: 'nope', amount: '1' },
    { id: 'b', vault: V1, amount: '0' },
    { id: 'b', vault: V1, amount: '-5' },
    { id: 'b', vault: V1, amount: '1.5' },
    { id: 'b', vault: V1, amount: 10 },
    { id: 'b', vault: V1, amount: '9'.repeat(78) },
    { id: '', vault: V1, amount: '1' },
  ];
  for (const b of bad) assert.equal((await call('POST', '/sales', b)).status, 400, JSON.stringify(b));
  assert.equal(store.sales.size, 1);
});

test('body: JSON inválido 400, no objeto 400, más de 16 KB 413', async () => {
  assert.equal((await call('POST', '/sales', '{nope')).status, 400);
  assert.equal((await call('POST', '/sales', '[1]')).status, 400);
  assert.equal((await call('POST', '/sales', { id: 'x'.repeat(MAX_BODY) })).status, 413);
});

test('rutas: 404 desconocida, 400 ruta mal codificada, 500 si falla el RPC al crear', async () => {
  assert.equal((await call('GET', '/nada')).status, 404);
  assert.equal((await call('GET', '/sales/%E0%A4%A')).status, 400);
  chain.fail = true;
  assert.equal((await call('POST', '/sales', { id: 'r', vault: V1, amount: '1' })).status, 500);
  chain.fail = false;
  assert.equal(store.sales.has('r'), false);
});

test('POST /sales/:id/tx: 404, 400 y 409', async () => {
  assert.equal((await call('POST', '/sales/nope/tx', { txHash: h(1) })).status, 404);
  assert.equal((await call('POST', '/sales/a1/tx', { txHash: '0xAA' })).status, 400);
  assert.equal((await call('POST', '/sales/a1/tx', {})).status, 400);
});

test('punta a punta: crear venta, informar tx, poll y status cobrada', async () => {
  const amount = '1234500000000000000000';
  assert.equal((await call('POST', '/sales', { id: 'e2e', vault: V1, amount })).status, 201);
  const tx = await call('POST', '/sales/e2e/tx', { txHash: h(7) });
  assert.deepEqual([tx.status, tx.body], [200, { id: 'e2e', status: 'pendiente' }]);
  assert.deepEqual((await call('GET', '/sales/e2e')).body, { id: 'e2e', vault: V1, amount, status: 'pendiente', txHash: h(7) });

  chain.logs.push({ address: WARS, blockNumber: 101n, transactionHash: h(7), logIndex: 0, args: { from: '0x00000000000000000000000000000000000000b1', to: V1, value: BigInt(amount) } });
  chain.head = 102n;
  await indexer.pollOnce();
  assert.equal((await call('GET', '/sales/e2e')).body.status, 'pendiente');
  chain.head = 103n;
  await indexer.pollOnce();
  assert.deepEqual((await call('GET', '/sales/e2e')).body, { id: 'e2e', vault: V1, amount, status: 'cobrada', txHash: h(7) });

  assert.equal((await call('POST', '/sales/e2e/tx', { txHash: h(7) })).status, 200);
  assert.equal((await call('POST', '/sales/e2e/tx', { txHash: h(8) })).status, 409);
});

test('el servicio no arranca sin TILDAI_INDEXER_TOKEN', async () => {
  await assert.rejects(start({ TILDAI_NETWORK: 'celo-sepolia', TILDAI_STORE_PATH: 'x.json' }), /TILDAI_INDEXER_TOKEN/);
  await assert.rejects(start({ TILDAI_INDEXER_TOKEN: 'corto', TILDAI_NETWORK: 'celo-sepolia', TILDAI_STORE_PATH: 'x.json' }), /TILDAI_INDEXER_TOKEN/);
});
