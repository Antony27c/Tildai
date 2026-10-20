import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndexer, Store, parseWars, WARS, vaultCreatedEvent, type ChainReader, type Log } from '../src/indexer.ts';
import { deserialize, fileSaver, loadStore, saveStore, serialize } from '../src/persist.ts';

const F = '0x00000000000000000000000000000000000000f0';
const V1 = '0x00000000000000000000000000000000000000a1';
const h1 = `0x${'1'.repeat(64)}`;

const logs: Log[] = [
  { address: F, blockNumber: 5n, transactionHash: `0x${'c'.repeat(64)}`, logIndex: 0, args: { vault: V1, owner: '0x00000000000000000000000000000000000000c1' } },
  { address: WARS, blockNumber: 50n, transactionHash: h1, logIndex: 0, args: { from: '0x00000000000000000000000000000000000000b1', to: V1, value: parseWars('1234.5') } },
];
const client: ChainReader = {
  getBlockNumber: async () => 100n,
  getBlock: async (p) => ({ timestamp: 1700000000n + p.blockNumber * 5n }),
  getLogs: async (p) => logs.filter((l) => l.address === p.address && (p.event === vaultCreatedEvent || p.args!.to.includes(l.args.to!)) && l.blockNumber! >= p.fromBlock && l.blockNumber! <= p.toBlock),
};
const mk = (store: Store, save?: (s: Store) => Promise<void>) =>
  createIndexer({ client, store, factory: F, startBlock: 1n, confirmations: 2n, rescan: 0n, retries: 0, save, onError: () => {} });
const tmp = async () => join(await mkdtemp(join(tmpdir(), 'tildai-')), 'store.json');

test('un reinicio conserva ventas, pagos, vaults y cursores, con bigint exactos', async () => {
  const path = await tmp();
  const a = new Store();
  const idxA = mk(a, fileSaver(path));
  await idxA.createSale({ id: 's1', vault: V1, amount: parseWars('1234.5') });
  await idxA.createSale({ id: 's2', vault: V1, amount: 77n });
  a.sales.get('s1')!.createdBlock = 10n;
  await idxA.markPaidByTx('s2', h1);
  assert.equal((await idxA.pollOnce()).ok, true);

  const b = await loadStore(path);
  assert.deepEqual(b, a);
  assert.equal(b.sales.get('s1')!.status, 'cobrada');
  assert.equal(b.sales.get('s1')!.amount, 1234500000000000000000n);
  assert.deepEqual(b.sales.get('s2')!.txHashes, [h1]);
  const r = await mk(b, fileSaver(path)).pollOnce();
  assert.equal(r.ok && r.newPayments, 0);
  assert.equal(b.payments.size, 1);
});

test('la escritura atómica no deja temporales', async () => {
  const path = await tmp();
  await saveStore(new Store(), path);
  await saveStore(new Store(), path);
  assert.deepEqual(await readdir(join(path, '..')), ['store.json']);
});

test('un store v1 con txHash suelto migra a txHashes y se reescribe como v3', async () => {
  const v1 = JSON.stringify({
    version: 1, cursor: null, vaultCursor: null, vaults: [[V1, '0x00000000000000000000000000000000000000c1']], events: [],
    sales: [{ id: 's1', vault: V1, amount: '9', createdBlock: '1', createdAt: 0, status: 'pendiente', txHash: h1 }],
    payments: [],
  });
  const s = deserialize(v1);
  assert.deepEqual(s.sales.get('s1')!.txHashes, [h1]);
  const d3 = JSON.parse(serialize(s));
  assert.equal(d3.version, 3);
  assert.deepEqual(d3.sales[0].txHashes, [h1]);
});

test('timestampUnavailable hace ida y vuelta (v3); un store v2 lo lee sin el campo', async () => {
  const s = new Store();
  s.payments.set('p:0', { id: 'p:0', vault: V1, from: '0x00000000000000000000000000000000000000b1', amount: 9n, block: 1n, txHash: h1, timestampUnavailable: true });
  const vuelta = deserialize(serialize(s));
  assert.equal(vuelta.payments.get('p:0')!.timestampUnavailable, true);
  // v2 no conocía el campo: deserializa igual y el pago se re-marca en el próximo poll.
  const v2 = JSON.stringify({ version: 2, cursor: null, vaultCursor: null, vaults: [], events: [], sales: [], payments: [{ id: 'p:0', vault: V1, from: '0x00000000000000000000000000000000000000b1', amount: '9', block: '1', txHash: h1 }] });
  assert.equal(deserialize(v2).payments.get('p:0')!.timestampUnavailable, undefined);
  // Un booleano que no es booleano rompe, como el resto de los campos.
  const malo = JSON.parse(v2);
  malo.version = 3;
  malo.payments[0].timestampUnavailable = 'si';
  assert.throws(() => deserialize(JSON.stringify(malo)), /timestampUnavailable no es boolean/);
});

test('archivo ausente es primer arranque: store vacío', async () => {
  assert.equal((await loadStore(await tmp())).sales.size, 0);
});

test('archivo corrupto falla con error claro, no arranca vacío', async () => {
  const path = await tmp();
  for (const bad of ['{"version":1,"sales":', '{"version":2}', '{"version":1,"cursor":"abc","vaults":[],"sales":[],"payments":[]}', '[]']) {
    await writeFile(path, bad);
    await assert.rejects(loadStore(path), /corrupto/);
  }
});

test('si no se puede guardar, createSale y pollOnce lo informan', async () => {
  const store = new Store();
  const idx = mk(store, async () => { throw new Error('disco lleno'); });
  await assert.rejects(idx.createSale({ id: 's1', vault: V1, amount: 1n }), /disco lleno/);
  assert.equal((await idx.pollOnce()).ok, false);
});
