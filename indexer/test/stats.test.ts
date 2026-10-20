import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Store, type Payment } from '../src/indexer.ts';
import { createApp, stats } from '../src/server.ts';
import { saveStore, loadStore } from '../src/persist.ts';

const V1 = '0x00000000000000000000000000000000000000a1';
const V2 = '0x00000000000000000000000000000000000000a2';
const V3 = '0x00000000000000000000000000000000000000a3';
const TOKEN = 'token-de-prueba-largo';
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const UTC = Date.UTC;
// 2026-10-19 10:00 UTC = 07:00 en Argentina: byDay cubre 2026-10-06 a 2026-10-19.
const NOW = UTC(2026, 9, 19, 10);

const pay = (id: number, vault: string, amount: bigint, timestamp?: number): Payment => ({
  id: `${h(id)}:0`, vault, from: '0x00000000000000000000000000000000000000b1',
  amount, block: 1n, txHash: h(id), ...(timestamp != null && { timestamp }),
});

// V1 y V2 con pagos de varios días; V3 sin pagos (no es activo); s1 cobrada, s2 pendiente; p4 sin timestamp.
function storeConDatos() {
  const s = new Store();
  s.vaults.set(V1, '0x00000000000000000000000000000000000000c1');
  s.vaults.set(V2, '0x00000000000000000000000000000000000000c2');
  s.vaults.set(V3, '0x00000000000000000000000000000000000000c3');
  s.addSale({ id: 's1', vault: V1, amount: 100n, createdBlock: 1n, createdAt: NOW });
  s.addSale({ id: 's2', vault: V1, amount: 50n, createdBlock: 1n, createdAt: NOW });
  s.sales.get('s1')!.status = 'cobrada';
  for (const p of [
    pay(1, V1, 100n, UTC(2026, 9, 15, 12)),
    pay(2, V2, 250n, UTC(2026, 9, 8, 12)), // más de 7 días: no es activo
    pay(3, V1, 30n, UTC(2026, 9, 1, 12)), // más de 14 días: solo en los totales
    pay(4, V2, 999n), // sin timestamp
    pay(5, V1, 7n, UTC(2026, 9, 19, 2, 59, 59)), // 18/10 23:59:59 AR
    pay(6, V1, 8n, UTC(2026, 9, 19, 3, 0, 0)), // 19/10 00:00:00 AR
    pay(7, V2, 40n, UTC(2026, 9, 13, 12)),
    pay(8, V3, 5n, UTC(2026, 9, 12, 12)), // día AR 12/10: dentro de 7x24h, fuera de los 7 días calendario AR
  ]) s.payments.set(p.id, p);
  return s;
}

const byDay = (r: ReturnType<typeof stats>, day: string) => r.byDay.find((x) => x.day === day)!;

test('stats: totales con bigint, activos a 7 días y pagos sin timestamp', () => {
  const r = stats(storeConDatos(), 42220, NOW);
  assert.equal(r.chainId, 42220); // viene de la config, así /metricas no adivina la red
  assert.equal(r.vaults, 3);
  assert.equal(r.payments, 8);
  assert.equal(r.salesCobradas, 1);
  assert.equal(r.warsReceived, '1439'); // 100+250+30+999+7+8+40+5, sin floats
  assert.equal(r.paymentsWithoutTimestamp, 1);
  assert.equal(r.activeVaults7d, 2); // 7 días calendario AR (13/10 a 19/10): el pago de V3 fue el 12/10 y el de V2 el 8/10
  assert.equal(r.generatedAt, new Date(NOW).toISOString());
});

test('stats: byDay son 14 días en hora argentina, con días vacíos en cero', () => {
  const r = stats(storeConDatos(), 42220, NOW);
  assert.equal(r.byDay.length, 14);
  assert.equal(r.byDay[0].day, '2026-10-06');
  assert.equal(r.byDay.at(-1)!.day, '2026-10-19');
  assert.deepEqual(byDay(r, '2026-10-08'), { day: '2026-10-08', payments: 1, warsReceived: '250' });
  assert.deepEqual(byDay(r, '2026-10-13'), { day: '2026-10-13', payments: 1, warsReceived: '40' });
  assert.deepEqual(byDay(r, '2026-10-15'), { day: '2026-10-15', payments: 1, warsReceived: '100' });
  assert.deepEqual(byDay(r, '2026-10-12'), { day: '2026-10-12', payments: 1, warsReceived: '5' });
  assert.deepEqual(byDay(r, '2026-10-18'), { day: '2026-10-18', payments: 1, warsReceived: '7' });
  assert.deepEqual(byDay(r, '2026-10-19'), { day: '2026-10-19', payments: 1, warsReceived: '8' });
  assert.deepEqual(byDay(r, '2026-10-07'), { day: '2026-10-07', payments: 0, warsReceived: '0' });
  // p3 (1/10) queda afuera de la ventana de 14 días y p4 no tiene timestamp: solo 6 entran en byDay.
  assert.equal(r.byDay.reduce((n, d) => n + d.payments, 0), 6);
});

test('stats: la medianoche argentina es a las 03:00 UTC', () => {
  const s = new Store();
  s.vaults.set(V1, '0x00000000000000000000000000000000000000c1');
  s.payments.set('a:0', pay(1, V1, 1n, UTC(2026, 9, 19, 2, 59, 59, 999)));
  s.payments.set('b:0', pay(2, V1, 2n, UTC(2026, 9, 19, 3, 0, 0)));
  const r = stats(s, 42220, NOW);
  assert.equal(byDay(r, '2026-10-18').warsReceived, '1');
  assert.equal(byDay(r, '2026-10-19').warsReceived, '2');
});

test('stats: sobrevive un reinicio leyendo el JSON persistido', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'tildai-')), 'store.json');
  const original = storeConDatos();
  await saveStore(original, path);
  const cargado = await loadStore(path);
  assert.deepEqual(stats(cargado, 42220, NOW), stats(original, 42220, NOW));
});

let server: Server;
let base: string;
before(async () => {
  const store = storeConDatos();
  const indexer = { createSale: async () => { throw new Error('no usado'); }, markPaidByTx: async () => { throw new Error('no usado'); } };
  server = createApp({ indexer, store, token: TOKEN, chainId: 42220, onError: () => {} });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
const get = async (path: string, auth: string | null = `Bearer ${TOKEN}`) => {
  const r = await fetch(base + path, { headers: auth ? { authorization: auth } : {} });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

test('GET /stats: 401 sin token y 200 con la forma esperada', async () => {
  assert.equal((await get('/stats', null)).status, 401);
  const r = await get('/stats');
  assert.equal(r.status, 200);
  assert.equal(r.body.chainId, 42220);
  assert.equal(r.body.vaults, 3);
  assert.equal(r.body.payments, 8);
  assert.equal(r.body.salesCobradas, 1);
  assert.equal(r.body.warsReceived, '1439');
  assert.equal(r.body.paymentsWithoutTimestamp, 1);
  const byDay = r.body.byDay as { day: string; payments: number; warsReceived: string }[];
  assert.equal(byDay.length, 14);
  assert.match(byDay[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof r.body.generatedAt, 'string');
});
