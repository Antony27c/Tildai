import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eachChunk, withRetry } from '../src/rpc.ts';

test('eachChunk parte el rango sin huecos ni solapes', async () => {
  const seen: [bigint, bigint][] = [];
  await eachChunk(1n, 25n, 10n, async (a, b) => { seen.push([a, b]); });
  assert.deepEqual(seen, [[1n, 10n], [11n, 20n], [21n, 25n]]);
});

test('eachChunk con rango vacío no llama y con maxRange inválido lanza', async () => {
  await eachChunk(5n, 4n, 10n, async () => assert.fail('no debería llamarse'));
  await assert.rejects(eachChunk(1n, 5n, 0n, async () => {}));
});

test('withRetry reintenta con backoff exponencial y devuelve el resultado', async () => {
  let n = 0;
  const sleeps: number[] = [];
  const r = await withRetry(async () => { if (++n < 3) throw new Error('x'); return 'ok'; }, { retries: 3, backoffMs: 100, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual([r, n, sleeps], ['ok', 3, [100, 200]]);
});

test('withRetry lanza el último error al agotar los reintentos', async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { throw new Error(`fallo ${++n}`); }, { retries: 2, backoffMs: 1, sleep: async () => {} }), /fallo 3/);
  assert.equal(n, 3);
});
