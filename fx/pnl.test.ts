import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits } from 'viem';
import {
  calcularPnl,
  obtenerSwapsOnchain,
  obtenerTasaActualPreview,
  calcularPnlConTasaActual,
  type DolarizacionEjecutada,
} from './pnl.ts';

test('calcularPnl: P&L positivo cuando el dólar subió de precio', () => {
  // Compramos 1 USD₮ a 1.600 wARS
  const swaps: DolarizacionEjecutada[] = [
    {
      txHash: '0xabc1',
      warsSpent: parseUnits('1600', 18),
      usdtReceived: 1_000_000n, // 1 USD₮ (6 decimales)
    },
  ];

  // Tasa actual: 1.700 wARS por USD₮
  const currentRateWei = parseUnits('1700', 18);

  const res = calcularPnl(swaps, currentRateWei);

  assert.equal(res.status, 'ok');
  assert.equal(res.count, 1);
  assert.equal(res.totalWarsSpent, parseUnits('1600', 18));
  assert.equal(res.totalUsdtReceived, 1_000_000n);
  assert.equal(res.averageRateWei, parseUnits('1600', 18));
  assert.equal(res.currentValueWars, parseUnits('1700', 18));
  // P&L positivo: +100 wARS
  assert.equal(res.pnlWars, parseUnits('100', 18));
  assert.ok(res.pnlWars! > 0n);
});

test('calcularPnl: P&L negativo cuando el dólar bajó de precio', () => {
  // Compramos 1 USD₮ a 1.700 wARS
  const swaps: DolarizacionEjecutada[] = [
    {
      txHash: '0xabc2',
      warsSpent: parseUnits('1700', 18),
      usdtReceived: 1_000_000n,
    },
  ];

  // Tasa actual: 1.600 wARS por USD₮
  const currentRateWei = parseUnits('1600', 18);

  const res = calcularPnl(swaps, currentRateWei);

  assert.equal(res.status, 'ok');
  assert.equal(res.totalWarsSpent, parseUnits('1700', 18));
  assert.equal(res.totalUsdtReceived, 1_000_000n);
  assert.equal(res.averageRateWei, parseUnits('1700', 18));
  assert.equal(res.currentValueWars, parseUnits('1600', 18));
  // P&L negativo: -100 wARS
  assert.equal(res.pnlWars, -parseUnits('100', 18));
  assert.ok(res.pnlWars! < 0n);
});

test('calcularPnl: P&L cero cuando el dólar se mantiene en el mismo precio', () => {
  const swaps: DolarizacionEjecutada[] = [
    {
      txHash: '0xabc3',
      warsSpent: parseUnits('1617.33', 18),
      usdtReceived: 1_000_000n,
    },
  ];

  const currentRateWei = parseUnits('1617.33', 18);

  const res = calcularPnl(swaps, currentRateWei);

  assert.equal(res.status, 'ok');
  assert.equal(res.pnlWars, 0n);
  assert.equal(res.currentValueWars, res.totalWarsSpent);
});

test('calcularPnl: lista vacía retorna valores en 0n', () => {
  const currentRateWei = parseUnits('1700', 18);
  const res = calcularPnl([], currentRateWei);

  assert.equal(res.status, 'ok');
  assert.equal(res.count, 0);
  assert.equal(res.totalWarsSpent, 0n);
  assert.equal(res.totalUsdtReceived, 0n);
  assert.equal(res.averageRateWei, 0n);
  assert.equal(res.currentValueWars, 0n);
  assert.equal(res.pnlWars, 0n);
});

test('calcularPnl: tasa faltante reporta status sin_tasa_actual y nunca usa tasa por defecto', () => {
  const swaps: DolarizacionEjecutada[] = [
    {
      txHash: '0xabc4',
      warsSpent: parseUnits('1600', 18),
      usdtReceived: 1_000_000n,
    },
  ];

  // Llamada sin tasa actual
  const res = calcularPnl(swaps, undefined);

  assert.equal(res.status, 'sin_tasa_actual');
  assert.equal(res.count, 1);
  assert.equal(res.totalWarsSpent, parseUnits('1600', 18));
  assert.equal(res.totalUsdtReceived, 1_000_000n);
  assert.equal(res.averageRateWei, parseUnits('1600', 18));
  assert.equal(res.currentRateWei, undefined);
  assert.equal(res.currentValueWars, undefined);
  assert.equal(res.pnlWars, undefined);
});

test('calcularPnl: redondeo y ponderación exacta con aritmética pura de bigint', () => {
  // Dos swaps con montos irregulares
  const swaps: DolarizacionEjecutada[] = [
    {
      warsSpent: 1000n * 10n ** 18n,
      usdtReceived: 618303n, // ~1617.33 wARS/USDT
    },
    {
      warsSpent: 2500n * 10n ** 18n,
      usdtReceived: 1545758n, // ~1617.33 wARS/USDT
    },
  ];

  const currentRateWei = 1650n * 10n ** 18n;
  const res = calcularPnl(swaps, currentRateWei);

  const totalSpent = 3500n * 10n ** 18n;
  const totalUsdt = 618303n + 1545758n; // 2164061n

  assert.equal(res.totalWarsSpent, totalSpent);
  assert.equal(res.totalUsdtReceived, totalUsdt);

  // averageRateWei = (totalSpent * 10^6) / totalUsdt
  const expectedAvgRate = (totalSpent * 10n ** 6n) / totalUsdt;
  assert.equal(res.averageRateWei, expectedAvgRate);

  // currentValue = (totalUsdt * currentRateWei) / 10^6
  const expectedCurrentValue = (totalUsdt * currentRateWei) / 10n ** 6n;
  assert.equal(res.currentValueWars, expectedCurrentValue);

  // pnlWars = currentValue - totalSpent
  assert.equal(res.pnlWars, expectedCurrentValue - totalSpent);
  assert.ok(typeof res.pnlWars === 'bigint');
});

test('obtenerSwapsOnchain: consulta eventos Swapped por tramos (chunking) con viem', async () => {
  const requestedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];

  const mockLogs = [
    {
      transactionHash: '0x1111',
      args: {
        opId: '0xaaa1',
        from: 0, // Bucket.Operating
        warsSpent: parseUnits('500', 18),
        usdtReceived: 309151n,
      },
    },
    {
      transactionHash: '0x2222',
      args: {
        opId: '0xaaa2',
        from: 1, // Bucket.Savings
        warsSpent: parseUnits('1000', 18),
        usdtReceived: 618303n,
      },
    },
  ];

  const mockClient = {
    getLogs: async (params: any) => {
      requestedRanges.push({ fromBlock: params.fromBlock, toBlock: params.toBlock });
      if (params.fromBlock === 100n) {
        return [mockLogs[0]];
      } else if (params.fromBlock === 150n) {
        return [mockLogs[1]];
      }
      return [];
    },
  };

  const vault = '0x1234567890123456789012345678901234567890' as const;

  // Rango 100 a 220 con chunkSize de 50 -> 3 tramos: 100-149, 150-199, 200-220
  const swaps = await obtenerSwapsOnchain({
    client: mockClient,
    vaultAddresses: [vault],
    fromBlock: 100n,
    toBlock: 220n,
    chunkSize: 50n,
  });

  assert.equal(requestedRanges.length, 3);
  assert.deepEqual(requestedRanges[0], { fromBlock: 100n, toBlock: 149n });
  assert.deepEqual(requestedRanges[1], { fromBlock: 150n, toBlock: 199n });
  assert.deepEqual(requestedRanges[2], { fromBlock: 200n, toBlock: 220n });

  assert.equal(swaps.length, 2);
  assert.equal(swaps[0].txHash, '0x1111');
  assert.equal(swaps[0].warsSpent, parseUnits('500', 18));
  assert.equal(swaps[0].usdtReceived, 309151n);
  assert.equal(swaps[0].fromBucket, 0);

  assert.equal(swaps[1].txHash, '0x2222');
  assert.equal(swaps[1].warsSpent, parseUnits('1000', 18));
  assert.equal(swaps[1].fromBucket, 1);
});

test('obtenerTasaActualPreview y calcularPnlConTasaActual: obtiene tasa de preview exitoso', async () => {
  const mockPreviewResponse = {
    data: {
      status: 'preview',
      sellAmount: '1000000000000000000000', // 1000 wARS
      buyAmount: '618303',                 // ~0.618303 USD₮
      feeAmount: '99990000999900009',
    },
  };

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockPreviewResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const rateWei = await obtenerTasaActualPreview({ fetchFn: fakeFetch as typeof fetch });
  assert.ok(rateWei !== undefined);
  // (1000 * 10^18 * 10^6) / 618303 = 1617329982225545905n
  assert.equal(rateWei, (1000n * 10n ** 18n * 10n ** 6n) / 618303n);

  const swaps: DolarizacionEjecutada[] = [
    {
      warsSpent: 1000n * 10n ** 18n,
      usdtReceived: 618303n,
    },
  ];

  const pnlRes = await calcularPnlConTasaActual(swaps, { fetchFn: fakeFetch as typeof fetch });
  assert.equal(pnlRes.status, 'ok');
  assert.equal(pnlRes.currentRateWei, rateWei);
});

test('calcularPnlConTasaActual: si preview falla, reporta sin_tasa_actual sin inventar tasa', async () => {
  const fakeFailingFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify({ data: { status: 'no_quote' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const swaps: DolarizacionEjecutada[] = [
    {
      warsSpent: 1000n * 10n ** 18n,
      usdtReceived: 618303n,
    },
  ];

  const pnlRes = await calcularPnlConTasaActual(swaps, { fetchFn: fakeFailingFetch as typeof fetch });
  assert.equal(pnlRes.status, 'sin_tasa_actual');
  assert.equal(pnlRes.currentRateWei, undefined);
  assert.equal(pnlRes.pnlWars, undefined);
  assert.equal(pnlRes.totalWarsSpent, 1000n * 10n ** 18n);
});
