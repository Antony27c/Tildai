import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndexer, Store, parseWars, WARS, transferEvent, type ChainReader, type TransferLog } from '../src/indexer.ts';

const V1 = '0x00000000000000000000000000000000000000a1';
const V2 = '0x00000000000000000000000000000000000000a2';
const OTHER = '0x00000000000000000000000000000000000000ff';
const BUYER = '0x00000000000000000000000000000000000000b1';

const tr = (to: string, value: bigint, block: bigint, tx: string, logIndex = 0, address = WARS): TransferLog => ({
  address, blockNumber: block, transactionHash: tx, logIndex, args: { from: BUYER, to, value },
});

class FakeChain implements ChainReader {
  head = 100n;
  logs: TransferLog[] = [];
  fail = false;
  async getBlockNumber() { if (this.fail) throw new Error('rpc down'); return this.head; }
  async getLogs(p: Parameters<ChainReader['getLogs']>[0]) {
    if (this.fail) throw new Error('rpc down');
    assert.equal(p.event, transferEvent);
    return this.logs.filter((l) => l.blockNumber! >= p.fromBlock && l.blockNumber! <= p.toBlock && p.args.to.includes(l.args.to!));
  }
}

const setup = (extra = {}) => {
  const client = new FakeChain();
  const store = new Store();
  const idx = createIndexer({ client, store, vaults: [V1, V2], startBlock: 1n, onError: () => {}, ...extra });
  return { client, store, idx };
};

test('pago confirmado cobra la venta pendiente', async () => {
  const { client, store, idx } = setup();
  store.addSale({ id: 's1', vault: V1, amount: parseWars('8500') });
  client.logs.push(tr(V1, parseWars('8500'), 50n, '0xAA'));
  const r = await idx.pollOnce();
  assert.deepEqual([r.ok, r.ok && r.matched], [true, 1]);
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
  assert.equal(store.sales.get('s1')!.paymentId, '0xaa:0');
});

test('pago sin confirmaciones suficientes no cobra', async () => {
  const { client, store, idx } = setup();
  store.addSale({ id: 's1', vault: V1, amount: 1n });
  client.logs.push(tr(V1, 1n, 99n, '0xAA'));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
  client.head = 101n;
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});

test('evento repetido no duplica pago ni cobra dos ventas', async () => {
  const { client, store, idx } = setup();
  store.addSale({ id: 's1', vault: V1, amount: 5n });
  store.addSale({ id: 's2', vault: V1, amount: 5n });
  client.logs.push(tr(V1, 5n, 50n, '0xAA'));
  await idx.pollOnce();
  store.cursor = null;
  const r = await idx.pollOnce();
  assert.equal(store.payments.size, 1);
  assert.equal(r.ok && r.newPayments, 0);
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
  assert.equal(store.sales.get('s2')!.status, 'pendiente');
});

test('dos transfers en la misma tx tienen ids distintos', async () => {
  const { client, store, idx } = setup();
  client.logs.push(tr(V1, 5n, 50n, '0xAA', 0), tr(V1, 5n, 50n, '0xAA', 1));
  await idx.pollOnce();
  assert.equal(store.payments.size, 2);
});

test('falla del RPC deja la venta pendiente, no avanza el cursor y reintenta', async () => {
  const { client, store, idx } = setup();
  store.addSale({ id: 's1', vault: V1, amount: 7n });
  client.logs.push(tr(V1, 7n, 50n, '0xAA'));
  client.fail = true;
  assert.equal((await idx.pollOnce()).ok, false);
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
  assert.equal(store.cursor, null);
  client.fail = false;
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});

test('falla a mitad de rango no pierde bloques', async () => {
  const { client, store, idx } = setup({ maxRange: 10n });
  store.addSale({ id: 's1', vault: V1, amount: 7n });
  client.logs.push(tr(V1, 7n, 50n, '0xAA'));
  const orig = client.getLogs.bind(client);
  let n = 0;
  client.getLogs = async (p) => { if (++n === 3) throw new Error('boom'); return orig(p); };
  assert.equal((await idx.pollOnce()).ok, false);
  assert.equal(store.cursor, 21n);
  client.getLogs = orig;
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});

test('montos con 18 decimales: exactos y sin redondeo', async () => {
  assert.equal(parseWars('8500'), 8500n * 10n ** 18n);
  assert.equal(parseWars('0.000000000000000001'), 1n);
  assert.equal(parseWars('1234.5'), 1234500000000000000000n);
  assert.throws(() => parseWars('1.0000000000000000001'));
  assert.throws(() => parseWars('-1'));
  const { client, store, idx } = setup();
  store.addSale({ id: 's1', vault: V1, amount: parseWars('1234.5') });
  client.logs.push(tr(V1, parseWars('1234.5') - 1n, 50n, '0xAA', 0));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
  client.logs.push(tr(V1, parseWars('1234.5'), 51n, '0xBB', 0));
  store.cursor = null;
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
  assert.equal(store.sales.get('s1')!.paymentId, '0xbb:0');
});

test('ignora otro vault y otro token', async () => {
  const { client, store, idx } = setup();
  store.addSale({ id: 's1', vault: V1, amount: 5n });
  client.logs.push(tr(OTHER, 5n, 50n, '0xA1'), tr(V1, 5n, 51n, '0xA2', 0, OTHER), tr(V2, 5n, 52n, '0xA3'));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
  assert.equal(store.payments.size, 1);
});

test('pago anterior a la venta se cruza después', async () => {
  const { client, store, idx } = setup();
  client.logs.push(tr(V1, 9n, 50n, '0xAA'));
  await idx.pollOnce();
  store.addSale({ id: 's1', vault: V1, amount: 9n });
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});
