import test from 'node:test';
import assert from 'node:assert/strict';
import { cotizar, cotizarFirme, CELO_CHAIN_ID, CONTRACTS } from './index.ts';

const MOCK_VAULT = '0x1234567890123456789012345678901234567890' as const;
const MOCK_KEY = 'secret-textile-partner-key-xyz';

// Payload base feliz retornado por POST /v2/rfq/request
function buildHappyFirmResponse(overrides: Record<string, any> = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    data: {
      status: 'quoted',
      sellAmount: '1000000000000000000000', // 1000 wARS
      takerPays: '1000000000000000000000',  // 1000 wARS
      buyAmount: '618303',                  // ~0.618303 USD₮ (~1617.33 ARS/USDT)
      feeAmount: '99990000999900009',
      expiresAt: nowSec + 60,               // vence en 60s
      spender: CONTRACTS.limitOrderReactor,
      transactions: {
        swap: {
          to: CONTRACTS.limitOrderReactor,
          data: '0x12345678abcdef',
          value: '0',
          chainId: CELO_CHAIN_ID,
        },
      },
      ...overrides,
    },
  };
}

// ------------------------------------------------------------- Tests de cotizar (Preview)

test('cotizar: calcula cotización exitosa wARS -> USD₮ con preview falso', async () => {
  const mockResponse = {
    data: {
      status: 'preview',
      sellAmount: '1000000000000000000000',
      buyAmount: '618303',
      feeAmount: '99990000999900009',
      takerPays: '1000000000000000000000',
      rateRay: '618364830299999999999382',
      availableSellAmount: '153489433052390532125710149',
    },
  };

  let capturedUrl = '';
  let capturedBody: any = null;

  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUrl = url.toString();
    capturedBody = JSON.parse(init?.body as string);
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const resultado = await cotizar('1000', { fetchFn: fakeFetch as typeof fetch });

  assert.equal(capturedUrl, 'https://api.textilecredit.com/v2/rfq/preview');
  assert.equal(capturedBody.chainId, CELO_CHAIN_ID);
  assert.equal(capturedBody.sellToken, CONTRACTS.wARS);
  assert.equal(capturedBody.buyToken, CONTRACTS.USDT);
  assert.equal(capturedBody.sellAmount, '1000000000000000000000');

  assert.equal(resultado.status, 'preview');
  assert.equal(resultado.sellAmount, 1000000000000000000000n);
  assert.equal(resultado.buyAmount, 618303n);
  assert.equal(resultado.feeAmount, 99990000999900009n);
  assert.equal(resultado.sellAmountFormatted, '1000');
  assert.equal(resultado.buyAmountFormatted, '0.618303');
  assert.equal(resultado.availableSellAmount, 153489433052390532125710149n);
  assert.ok(resultado.effectiveRate > 1617 && resultado.effectiveRate < 1618);
});

test('cotizar: soporta monto como bigint atómico y como number', async () => {
  const mockResponse = {
    data: {
      status: 'preview',
      sellAmount: '500000000000000000000',
      buyAmount: '309151',
      feeAmount: '49995000499950004',
      takerPays: '500000000000000000000',
      rateRay: '618364830299999999999382',
    },
  };

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const resNumber = await cotizar(500, { fetchFn: fakeFetch as typeof fetch });
  assert.equal(resNumber.sellAmount, 500000000000000000000n);
  assert.equal(resNumber.buyAmountFormatted, '0.309151');

  const resBigint = await cotizar(500000000000000000000n, { fetchFn: fakeFetch as typeof fetch });
  assert.equal(resBigint.sellAmount, 500000000000000000000n);
});

test('cotizar: maneja respuesta no_quote por falta de liquidez', async () => {
  const mockNoQuote = {
    data: {
      status: 'no_quote',
      reason: 'no_valid_quote',
      availableBuyAmount: '94912472527',
    },
  };

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockNoQuote), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const resultado = await cotizar('999999999', { fetchFn: fakeFetch as typeof fetch });
  assert.equal(resultado.status, 'no_quote');
  assert.equal(resultado.reason, 'no_valid_quote');
  assert.equal(resultado.buyAmount, 0n);
});

test('cotizar: valida montos inválidos o negativos', async () => {
  await assert.rejects(
    async () => cotizar('0'),
    /El monto a cotizar debe ser mayor a 0/
  );
});

test('cotizar: aborta por timeout cuando un fetch falso nunca responde', async () => {
  const hangingFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason ?? new Error('Aborted'));
      });
    });
  };

  await assert.rejects(
    async () => cotizar('1000', { fetchFn: hangingFetch as typeof fetch, timeoutMs: 50 }),
    (err: any) => err.name === 'TimeoutError' || /timeout|aborted/i.test(err.message)
  );
});

// ------------------------------------------------------------- Tests de cotizarFirme (Caso feliz y rechazos)

test('cotizarFirme: caso feliz devuelve argumentos para TildaiVault.swap', async () => {
  const now = 1756400000000;
  const mockResp = buildHappyFirmResponse({ expiresAt: Math.floor(now / 1000) + 60 });

  let capturedHeaders: any = null;
  let capturedBody: any = null;

  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedHeaders = init?.headers;
    capturedBody = JSON.parse(init?.body as string);
    return new Response(JSON.stringify(mockResp), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const args = await cotizarFirme(
    {
      monto: '1000',
      vaultAddress: MOCK_VAULT,
      maxRate: 1700,
      previewRate: 1617.33,
    },
    {
      apiKey: MOCK_KEY,
      fetchFn: fakeFetch as typeof fetch,
      nowMs: now,
    }
  );

  // Verificación de headers y payload
  assert.equal(capturedHeaders?.Authorization, `Bearer ${MOCK_KEY}`);
  assert.equal(capturedBody.taker, MOCK_VAULT);
  assert.equal(capturedBody.sellAmount, '1000000000000000000000');
  assert.equal(capturedBody.chainId, CELO_CHAIN_ID);

  // Verificación de los argumentos exactos de swap
  assert.equal(args.spender, CONTRACTS.limitOrderReactor);
  assert.equal(args.target, CONTRACTS.limitOrderReactor);
  assert.equal(args.data, '0x12345678abcdef');
  assert.equal(args.amountIn, 1000000000000000000000n);
  assert.equal(args.minOut, 618303n);
  assert.equal(args.expiresAt, Math.floor(now / 1000) + 60);
});

test('cotizarFirme: caso feliz funciona con VaultOrderExecutor como target', async () => {
  const now = 1756400000000;
  const mockResp = buildHappyFirmResponse({
    spender: CONTRACTS.vaultOrderExecutor,
    transactions: {
      swap: {
        to: CONTRACTS.vaultOrderExecutor,
        data: '0x9999aaaa',
      },
    },
    expiresAt: Math.floor(now / 1000) + 40,
  });

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const args = await cotizarFirme('1000', MOCK_VAULT, 1700, {
    apiKey: MOCK_KEY,
    fetchFn: fakeFetch as typeof fetch,
    nowMs: now,
  });

  assert.equal(args.spender, CONTRACTS.vaultOrderExecutor);
  assert.equal(args.target, CONTRACTS.vaultOrderExecutor);
});

test('cotizarFirme: rechaza si TEXTILE_API_KEY no está configurada', async () => {
  const oldKey = process.env.TEXTILE_API_KEY;
  delete process.env.TEXTILE_API_KEY;

  try {
    await assert.rejects(
      async () => cotizarFirme('1000', MOCK_VAULT, 1700),
      /TEXTILE_API_KEY no configurada/
    );
  } finally {
    if (oldKey) process.env.TEXTILE_API_KEY = oldKey;
  }
});

test('cotizarFirme: rechaza si expiresAt ya pasó', async () => {
  const now = 1756400000000;
  const mockResp = buildHappyFirmResponse({ expiresAt: Math.floor(now / 1000) - 10 }); // Pasó hace 10s

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch, nowMs: now }),
    /menos de 15s|ya expiró/
  );
});

test('cotizarFirme: rechaza si expiresAt vence en menos de 15 segundos', async () => {
  const now = 1756400000000;
  const mockResp = buildHappyFirmResponse({ expiresAt: Math.floor(now / 1000) + 14 }); // Vence en 14s

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch, nowMs: now }),
    /menos de 15s/
  );
});

test('cotizarFirme: rechaza si spender no está en el address book oficial de Celo', async () => {
  const mockResp = buildHappyFirmResponse({ spender: '0x9999999999999999999999999999999999999999' });

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch }),
    /spender 0x9999.*no está autorizado en Celo/
  );
});

test('cotizarFirme: rechaza si transactions.swap.to no está en el address book oficial de Celo', async () => {
  const mockResp = buildHappyFirmResponse({
    transactions: {
      swap: {
        to: '0x8888888888888888888888888888888888888888',
        data: '0x1234',
      },
    },
  });

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch }),
    /target 0x8888.*no está autorizado en Celo/
  );
});

test('cotizarFirme: rechaza si takerPays supera lo pedido', async () => {
  // Pedimos 1000 wARS, pero devuelve que takerPays es 1005 wARS
  const mockResp = buildHappyFirmResponse({
    takerPays: '1005000000000000000000',
  });

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch }),
    /takerPays.*supera el monto pedido/
  );
});

test('cotizarFirme: rechaza si la tasa wARS por USD₮ supera maxRate', async () => {
  // 1000 wARS dan 0.55 USD₮ -> tasa = 1000 / 0.55 = 1818.18 wARS/USDT (supera maxRate 1700)
  const mockResp = buildHappyFirmResponse({
    buyAmount: '550000',
  });

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch }),
    /supera maxRate/
  );

  // Mismo rechazo si maxRate se pasa en wei (formato Solidity de TildaiVault)
  const maxRateWei = 1700n * 10n ** 18n;
  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, maxRateWei, { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch }),
    /supera maxRate/
  );
});

test('cotizarFirme: rechaza si la tasa es más de 1% peor que la cotización preview previa', async () => {
  // Preview previa: 1617.33
  // 1% peor es 1633.50. Simulamos firma que da buyAmount = 605000 (tasa = 1000 / 0.605 = 1652.89, ~2.2% peor)
  const mockResp = buildHappyFirmResponse({
    buyAmount: '605000',
  });

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    async () =>
      cotizarFirme(
        {
          monto: '1000',
          vaultAddress: MOCK_VAULT,
          maxRate: 2000,
          previewRate: 1617.33,
        },
        { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch }
      ),
    /peor que preview/
  );
});

test('cotizarFirme: rechaza ante no_quote y devuelve el motivo sin tasa por defecto', async () => {
  const mockNoQuote = {
    data: {
      status: 'no_quote',
      reason: 'no_valid_quote_maker_timeout',
    },
  };

  const fakeFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockNoQuote), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: fakeFetch as typeof fetch }),
    /Cotización rechazada: no_valid_quote_maker_timeout/
  );
});

test('cotizarFirme: rechaza ante error HTTP y nunca filtra la API Key', async () => {
  const fakeErrorFetch = async (): Promise<Response> => {
    return new Response(`Error interno con token ${MOCK_KEY}`, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  };

  let caughtError: any = null;
  try {
    await cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: fakeErrorFetch as typeof fetch });
  } catch (err: any) {
    caughtError = err;
  }

  assert.ok(caughtError);
  assert.match(caughtError.message, /Error en API de Textile FX \(500\)/);
  assert.doesNotMatch(caughtError.message, new RegExp(MOCK_KEY));
});

test('cotizarFirme: aborta por timeout de 75s (o configurable)', async () => {
  const hangingFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason ?? new Error('Aborted'));
      });
    });
  };

  await assert.rejects(
    async () => cotizarFirme('1000', MOCK_VAULT, 1700, { apiKey: MOCK_KEY, fetchFn: hangingFetch as typeof fetch, timeoutMs: 50 }),
    (err: any) => err.name === 'TimeoutError' || /timeout/i.test(err.message)
  );
});
