import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createIndexer, Store, WARS, vaultCreatedEvent, type ChainReader, type Log } from '../src/indexer.ts';
import { createApp } from '../src/server.ts';
import { fileSaver, loadStore } from '../src/persist.ts';
import type { Server } from 'node:http';

const F = '0x00000000000000000000000000000000000000f0';
const V1 = '0x00000000000000000000000000000000000000a1';
const V2 = '0x00000000000000000000000000000000000000a2';
const TOKEN = 'token-de-prueba-largo';
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const ts = (b: bigint) => Number(1700000000n + b * 5n) * 1000;

const chain = { head: 200n, blocksFail: false, logs: [
  { address: F, blockNumber: 5n, transactionHash: h(90), logIndex: 0, args: { vault: V1, owner: '0x00000000000000000000000000000000000000c1' } },
  { address: F, blockNumber: 6n, transactionHash: h(91), logIndex: 0, args: { vault: V2, owner: '0x00000000000000000000000000000000000000c2' } },
] as Log[] };
const client: ChainReader = {
  async getBlockNumber() { return chain.head; },
  async getBlock(p) { if (chain.blocksFail) throw new Error('rpc down'); return { timestamp: 1700000000n + p.blockNumber * 5n }; },
  async getLogs(p) {
    return chain.logs.filter((l) => l.address === p.address && (p.event === vaultCreatedEvent ? l.args.vault : p.args!.to.includes(l.args.to!)) && l.blockNumber! >= p.fromBlock && l.blockNumber! <= p.toBlock);
  },
};

const nowMs = 1_700_000_050_000;
const tmp = await mkdtemp(join(tmpdir(), 'tildai-'));
const path = join(tmp, 'store.json');
const store = new Store();
const indexer = createIndexer({ client, store, factory: F, startBlock: 1n, confirmations: 2n, rescan: 0n, retries: 0, now: () => nowMs, save: fileSaver(path), onError: () => {} });
let server: Server;
let base: string;
before(async () => {
  server = createApp({ indexer, store, token: TOKEN, onError: () => {} });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
const get = async (path: string, auth: string | null = `Bearer ${TOKEN}`) => {
  const r = await fetch(base + path, { headers: auth ? { authorization: auth } : {} });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const tr = (to: string, value: bigint, block: bigint, tx: string): Log => ({
  address: WARS, blockNumber: block, transactionHash: tx, logIndex: 0, args: { from: '0x00000000000000000000000000000000000000b1', to, value },
});

// Datos base compartidos por todos los tests: ventas s1 (V1) y s2 (V2), pagos p1 (cobra s1), p2 (a V2, sin venta), p3 (a V1, sin venta).
test('base: ventas y pagos indexados', async () => {
  assert.equal((await indexer.pollOnce()).ok, true);
  await indexer.createSale({ id: 's1', vault: V1, amount: 100n });
  await indexer.createSale({ id: 's2', vault: V2, amount: 200n });
  chain.logs.push(tr(V1, 100n, 201n, h(1)), tr(V2, 250n, 202n, h(2)), tr(V1, 300n, 203n, h(3)));
  chain.head = 210n;
  assert.equal((await indexer.pollOnce()).ok, true);
  assert.equal(store.sales.get('s1')!.status, 'cobrada');
  assert.deepEqual(store.events.map((e) => e.type), ['venta_cobrada', 'pago_sin_venta', 'pago_sin_venta']);
});

test('GET /sales: filtra por vault y por rango [since, until)', async () => {
  const all = await get(`/sales?vault=${V1}`);
  assert.deepEqual(all.body, [{ id: 's1', vault: V1, amount: '100', status: 'cobrada', createdAt: nowMs }]);
  assert.deepEqual((await get(`/sales?vault=${V1}&since=${nowMs + 1}`)).body, []);
  assert.deepEqual((await get(`/sales?vault=${V1}&since=0&until=${nowMs}`)).body, []);
  assert.equal((await get(`/sales?vault=${V1}&until=${nowMs + 1}`)).status, 200);
  assert.equal((await get('/sales')).status, 400);
  assert.equal((await get('/sales?vault=0x123')).status, 400);
  assert.equal((await get(`/sales?vault=${V1}&since=2&until=1`)).status, 400);
  assert.equal((await get(`/sales?vault=${V1}&since=abc`)).status, 400);
  assert.equal((await get(`/sales?vault=${V1}&since=-5`)).status, 400);
  assert.equal((await get(`/sales?vault=${V1}`, null)).status, 401);
});

test('GET /payments: pagos con y sin venta, por vault y rango', async () => {
  const all = await get(`/payments?vault=${V1}`);
  assert.deepEqual(all.body, [
    { id: `${h(1)}:0`, from: '0x00000000000000000000000000000000000000b1', amount: '100', txHash: h(1), timestamp: ts(201n), saleId: 's1' },
    { id: `${h(3)}:0`, from: '0x00000000000000000000000000000000000000b1', amount: '300', txHash: h(3), timestamp: ts(203n) },
  ]);
  const rango = await get(`/payments?vault=${V1}&since=${ts(202n)}&until=${ts(204n)}`);
  assert.deepEqual(rango.body, [((all.body as unknown[])[1])]);
  assert.deepEqual((await get(`/payments?vault=${V2}`)).body, [
    { id: `${h(2)}:0`, from: '0x00000000000000000000000000000000000000b1', amount: '250', txHash: h(2), timestamp: ts(202n) },
  ]);
  assert.equal((await get('/payments')).status, 400);
  assert.equal((await get(`/payments?vault=${V1}&until=abc`)).status, 400);
});

test('pagos sin timestamp no se pierden: se completan en el próximo poll', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tildai-'));
  const st = new Store();
  const idx = createIndexer({ client, store: st, factory: F, startBlock: 1n, confirmations: 2n, rescan: 0n, retries: 0, onError: () => {} });
  chain.blocksFail = true;
  chain.logs.push(tr(V1, 400n, 180n, h(4)));
  assert.equal((await idx.pollOnce()).ok, true);
  const p = st.payments.get(`${h(4)}:0`)!;
  assert.equal(p.timestamp, undefined);
  chain.blocksFail = false;
  assert.equal((await idx.pollOnce()).ok, true);
  assert.equal(p.timestamp, ts(180n));
  chain.logs.pop();
});

test('GET /events: cursor sin repetir ni saltear, con pago sin venta', async () => {
  const t1 = await get('/events?since=0');
  assert.equal(t1.status, 200);
  const ev = t1.body.events as { seq: number; type: string; saleId?: string; payment: Record<string, unknown> }[];
  assert.deepEqual(ev.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(ev.map((e) => e.type), ['venta_cobrada', 'pago_sin_venta', 'pago_sin_venta']);
  assert.equal(ev[0].saleId, 's1');
  assert.equal(ev[1].payment.txHash, h(2));
  assert.equal(t1.body.cursor, 3);

  // Un pago nuevo solo sale desde el cursor guardado.
  chain.logs.push(tr(V1, 500n, 211n, h(5)));
  chain.head = 214n;
  assert.equal((await indexer.pollOnce()).ok, true);
  const t2 = await get('/events?since=3');
  assert.deepEqual((t2.body.events as { seq: number; type: string }[]).map((e) => [e.seq, e.type]), [[4, 'pago_sin_venta']]);
  const t3 = await get('/events?since=4');
  assert.deepEqual(t3.body.events, []);
  assert.equal((await get('/events?since=99')).status, 400);
  assert.equal((await get('/events?since=-1')).status, 400);
  assert.equal((await get('/events?since=x')).status, 400);
  chain.logs.pop();
});

test('ventas, pagos con timestamp, eventos y cursor sobreviven un reinicio', async () => {
  const st = await loadStore(path);
  assert.equal(st.sales.get('s1')!.status, 'cobrada');
  assert.equal(st.payments.get(`${h(1)}:0`)!.timestamp, ts(201n));
  assert.deepEqual(st.events.map((e) => [e.seq, e.type]), [[1, 'venta_cobrada'], [2, 'pago_sin_venta'], [3, 'pago_sin_venta'], [4, 'pago_sin_venta']]);
  // El cursor sigue siendo único después del reinicio.
  const idx2 = createIndexer({ client, store: st, factory: F, startBlock: 1n, confirmations: 2n, rescan: 0n, retries: 0, onError: () => {} });
  chain.logs.push(tr(V1, 600n, 215n, h(6)));
  chain.head = 218n;
  assert.equal((await idx2.pollOnce()).ok, true);
  assert.equal(st.events.at(-1)!.seq, 5);
});

test('GET /events: con más de 500 eventos el cursor permite leer de a tandas sin saltear ni repetir', async () => {
  const first = store.events.at(-1)?.seq ?? 0;
  for (let i = 1; i <= 505; i++) {
    const p: import('../src/indexer.ts').Payment = { id: `x:${i}`, vault: V1, from: '0x00000000000000000000000000000000000000b1', amount: 1n, block: 1n, txHash: h(i) };
    store.payments.set(p.id, p);
    store.addEvent('pago_sin_venta', p.id);
  }
  const t1 = await get(`/events?since=${first}`);
  assert.equal(t1.status, 200);
  const ev1 = t1.body.events as { seq: number }[];
  assert.equal(ev1.length, 500);
  assert.equal(t1.body.cursor, ev1.at(-1)!.seq);
  assert.equal(t1.body.cursor, first + 500);
  const t2 = await get(`/events?since=${t1.body.cursor}`);
  const ev2 = t2.body.events as { seq: number }[];
  assert.deepEqual([...ev1, ...ev2].map((e) => e.seq), Array.from({ length: 505 }, (_, i) => first + 1 + i));
});

test('GET /payments: sin rango incluye pagos sin timestamp con timestamp null, con rango da 503', async () => {
  store.payments.set('sints:0', { id: 'sints:0', vault: V1, from: '0x00000000000000000000000000000000000000b1', amount: 9n, block: 1n, txHash: h(50) });
  const all = await get(`/payments?vault=${V1}`);
  const sinTs = (all.body as { id: string; timestamp: number | null }[]).find((p) => p.id === 'sints:0');
  assert.equal(sinTs!.timestamp, null);
  assert.equal((await get(`/payments?vault=${V1}&since=0`)).status, 503);
  store.payments.delete('sints:0');
});
