import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndexer, Store, parseWars, WARS, transferEvent, vaultCreatedEvent, type ChainReader, type Log } from '../src/indexer.ts';

const F = '0x00000000000000000000000000000000000000f0';
const V1 = '0x00000000000000000000000000000000000000a1';
const V2 = '0x00000000000000000000000000000000000000a2';
const OTHER = '0x00000000000000000000000000000000000000ff';
const BUYER = '0x00000000000000000000000000000000000000b1';
const OWNER = '0x00000000000000000000000000000000000000c1';

const tr = (to: string, value: bigint, block: bigint, tx: string, logIndex = 0, address = WARS): Log => ({
  address, blockNumber: block, transactionHash: tx, logIndex, args: { from: BUYER, to, value },
});
const created = (vault: string, block: bigint, address = F): Log => ({
  address, blockNumber: block, transactionHash: `0xc${block}`, logIndex: 0, args: { vault, owner: OWNER },
});

class FakeChain implements ChainReader {
  head = 100n;
  logs: Log[] = [];
  fail = false;
  ranges: [bigint, bigint][] = [];
  async getBlockNumber() { if (this.fail) throw new Error('rpc down'); return this.head; }
  async getBlock(p: { blockNumber: bigint }) { if (this.fail) throw new Error('rpc down'); return { timestamp: p.blockNumber }; }
  async getLogs(p: Parameters<ChainReader['getLogs']>[0]) {
    if (this.fail) throw new Error('rpc down');
    this.ranges.push([p.fromBlock, p.toBlock]);
    const isCreated = p.event === vaultCreatedEvent;
    assert.ok(isCreated || p.event === transferEvent);
    return this.logs.filter((l) =>
      l.address.toLowerCase() === p.address.toLowerCase() &&
      (isCreated ? l.args.vault : l.args.to && p.args!.to.includes(l.args.to)) &&
      l.blockNumber! >= p.fromBlock && l.blockNumber! <= p.toBlock);
  }
}

const setup = (extra = {}) => {
  const client = new FakeChain();
  client.logs.push(created(V1, 5n), created(V2, 5n));
  const store = new Store();
  const idx = createIndexer({
    client, store, factory: F, startBlock: 1n, confirmations: 2n, rescan: 0n, retries: 0, onError: () => {}, ...extra,
  });
  return { client, store, idx };
};

const sell = async (client: FakeChain, idx: ReturnType<typeof createIndexer>, s: { id: string; vault: string; amount: bigint }, atBlock = 1n) => {
  const head = client.head;
  client.head = atBlock;
  try { return await idx.createSale(s); } finally { client.head = head; }
};

test('descubre los vaults desde VaultCreated de la factory', async () => {
  const { client, store, idx } = setup();
  client.logs.push(created(OTHER, 6n, '0x00000000000000000000000000000000000000ee'));
  const r = await idx.pollOnce();
  assert.equal(r.ok && r.newVaults, 2);
  assert.deepEqual([...store.vaults.keys()], [V1, V2]);
  assert.equal(store.vaults.get(V1), OWNER);
});

test('pago confirmado cobra la venta pendiente', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: parseWars('8500') });
  client.logs.push(tr(V1, parseWars('8500'), 50n, '0xAA'));
  const r = await idx.pollOnce();
  assert.deepEqual([r.ok, r.ok && r.matched], [true, 1]);
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
  assert.equal(store.sales.get('s1')!.paymentId, '0xaa:0');
});

test('pago sin confirmaciones suficientes no cobra', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 1n });
  client.logs.push(tr(V1, 1n, 99n, '0xAA'));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
  client.head = 101n;
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});

test('nunca se lee más allá de head - confirmaciones', async () => {
  const { client, idx } = setup({ confirmations: 5n });
  await idx.pollOnce();
  assert.ok(client.ranges.length > 0);
  assert.ok(client.ranges.every(([, to]) => to <= 95n));
});

test('el rango se parte en tramos de maxRange', async () => {
  const { client, idx } = setup({ maxRange: 30n });
  await idx.pollOnce();
  const transfers = client.ranges.slice(client.ranges.length / 2);
  assert.deepEqual(transfers, [[1n, 30n], [31n, 60n], [61n, 90n], [91n, 98n]]);
});

test('evento repetido no duplica pago ni cobra dos ventas', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 5n });
  await sell(client, idx, { id: 's2', vault: V1, amount: 5n });
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
  await sell(client, idx, { id: 's1', vault: V1, amount: 7n });
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
  await sell(client, idx, { id: 's1', vault: V1, amount: 7n });
  client.logs.push(tr(V1, 7n, 50n, '0xAA'));
  const orig = client.getLogs.bind(client);
  let transfers = 0;
  client.getLogs = async (p) => { if (p.event === transferEvent && ++transfers === 3) throw new Error('boom'); return orig(p); };
  assert.equal((await idx.pollOnce()).ok, false);
  assert.equal(store.cursor, 21n);
  client.getLogs = orig;
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});

test('un nodo atrasado que devuelve vacío no pierde el pago (rescan)', async () => {
  const { client, store, idx } = setup({ rescan: 20n });
  await sell(client, idx, { id: 's1', vault: V1, amount: 7n });
  const real = client.logs.slice();
  client.logs = real.filter((l) => l.args.vault);
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
  client.logs = [...real, tr(V1, 7n, 98n, '0xAA')];
  client.head = 101n;
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});

test('un vault que un nodo atrasado no mostró se descubre después, con sus pagos', async () => {
  const { client, store, idx } = setup({ rescan: 50n });
  const late = '0x00000000000000000000000000000000000000a3';
  client.logs.push(created(late, 60n), tr(late, 3n, 61n, '0xBB'));
  const real = client.logs.slice();
  client.logs = real.filter((l) => l.args.vault && l.args.vault !== late);
  await idx.pollOnce();
  assert.equal(store.vaults.has(late), false);
  await sell(client, idx, { id: 's1', vault: late, amount: 3n }, 50n);
  client.logs = real;
  const r = await idx.pollOnce();
  assert.equal(r.ok && r.newVaults, 1);
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});

test('montos con 18 decimales: exactos y sin redondeo', async () => {
  assert.equal(parseWars('8500'), 8500n * 10n ** 18n);
  assert.equal(parseWars('0.000000000000000001'), 1n);
  assert.equal(parseWars('1234.5'), 1234500000000000000000n);
  assert.throws(() => parseWars('1.0000000000000000001'));
  assert.throws(() => parseWars('-1'));
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: parseWars('1234.5') });
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
  await sell(client, idx, { id: 's1', vault: V1, amount: 5n });
  client.logs.push(tr(OTHER, 5n, 50n, '0xA1'), tr(V1, 5n, 51n, '0xA2', 0, OTHER), tr(V2, 5n, 52n, '0xA3'));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
  assert.equal(store.payments.size, 1);
});

test('el token wARS es configurable', async () => {
  const test = '0x00000000000000000000000000000000000000d1';
  const { client, store, idx } = setup({ token: test });
  await sell(client, idx, { id: 's1', vault: V1, amount: 5n });
  client.logs.push(tr(V1, 5n, 50n, '0xA1', 0, WARS), tr(V1, 5n, 51n, '0xA2', 0, test));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.paymentId, '0xa2:0');
});

test('pago anterior a la venta no la cobra y queda sin conciliar', async () => {
  const { client, store, idx } = setup();
  client.logs.push(tr(V1, 9n, 50n, '0xAA'));
  await idx.pollOnce();
  const sale = await sell(client, idx, { id: 's1', vault: V1, amount: 9n }, 60n);
  assert.equal(sale.createdBlock, 60n);
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
  assert.equal(store.payments.get('0xaa:0')!.saleId, undefined);
});

test('pago posterior a la venta sí la cobra', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 9n }, 60n);
  client.logs.push(tr(V1, 9n, 60n, '0xAA'));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
});

test('si el RPC falla al crear la venta no se crea', async () => {
  const { client, store, idx } = setup();
  client.fail = true;
  await assert.rejects(idx.createSale({ id: 's1', vault: V1, amount: 9n }));
  assert.equal(store.sales.size, 0);
});

const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

test('x402: la tx con Transfer confirmado al vault por el monto exacto cobra la venta', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 9n });
  client.logs.push(tr(V1, 9n, 50n, h(1)));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
  assert.equal(await idx.markPaidByTx('s1', h(1)), 'cobrada');
});

test('x402: la tx sin confirmar deja la venta pendiente y el próximo poll la cobra', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 9n });
  client.logs.push(tr(V1, 9n, 99n, h(1)));
  await idx.pollOnce();
  assert.equal(await idx.markPaidByTx('s1', h(1)), 'pendiente');
  client.head = 101n;
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
  assert.equal(store.sales.get('s1')!.paymentId, `${h(1)}:0`);
});

test('x402: tx con monto o vault equivocado no cobra', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 9n });
  client.logs.push(tr(V1, 8n, 50n, h(1)), tr(V2, 9n, 51n, h(2)));
  await idx.pollOnce();
  assert.equal(await idx.markPaidByTx('s1', h(1)), 'pendiente');
  assert.equal(await idx.markPaidByTx('s1', h(2)), 'pendiente');
  assert.equal(await idx.markPaidByTx('s1', h(3)), 'pendiente');
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
});

test('x402: el mismo pago no cobra dos ventas', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 9n });
  await sell(client, idx, { id: 's2', vault: V1, amount: 9n });
  client.logs.push(tr(V1, 9n, 50n, h(1)));
  await idx.pollOnce();
  await idx.markPaidByTx('s1', h(1));
  assert.equal(await idx.markPaidByTx('s2', h(1)), 'pendiente');
  await idx.pollOnce();
  assert.deepEqual([store.sales.get('s1')!.status, store.sales.get('s2')!.status], ['cobrada', 'pendiente']);
});

test('x402: una venta atada a una tx no la cobra otro pago de igual monto', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 9n });
  await idx.markPaidByTx('s1', h(1));
  client.logs.push(tr(V1, 9n, 50n, h(2)));
  await idx.pollOnce();
  assert.equal(store.sales.get('s1')!.status, 'pendiente');
});

test('x402: entradas inválidas y venta ya cobrada con otro pago', async () => {
  const { client, store, idx } = setup();
  await sell(client, idx, { id: 's1', vault: V1, amount: 9n });
  await assert.rejects(idx.markPaidByTx('nope', h(1)), /inexistente/);
  await assert.rejects(idx.markPaidByTx('s1', '0xAA'), /inválido/);
  client.logs.push(tr(V1, 9n, 50n, h(1)));
  await idx.pollOnce();
  await assert.rejects(idx.markPaidByTx('s1', h(2)), /otro pago/);
  assert.equal(store.sales.get('s1')!.paymentId, `${h(1)}:0`);
});
