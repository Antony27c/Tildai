import test from 'node:test';
import assert from 'node:assert/strict';
import { cotizar, CELO_CHAIN_ID, CONTRACTS } from './index.ts';

test('cotizar: calcula cotización exitosa wARS -> USD₮ con preview falso', async () => {
  // Simula respuesta oficial de Textile FX v2 RFQ preview
  const mockResponse = {
    data: {
      status: 'preview',
      sellAmount: '1000000000000000000000', // 1000 wARS
      buyAmount: '618303',                 // ~0.618303 USD₮
      feeAmount: '99990000999900009',      // ~1 bps (0.01%)
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

  // Cotizar 1000 wARS como string
  const resultado = await cotizar('1000', { fetchFn: fakeFetch as typeof fetch });

  // Verificaciones de llamada
  assert.equal(capturedUrl, 'https://api.textilecredit.com/v2/rfq/preview');
  assert.equal(capturedBody.chainId, CELO_CHAIN_ID);
  assert.equal(capturedBody.sellToken, CONTRACTS.wARS);
  assert.equal(capturedBody.buyToken, CONTRACTS.USDT);
  assert.equal(capturedBody.sellAmount, '1000000000000000000000');

  // Verificaciones de resultado parseado
  assert.equal(resultado.status, 'preview');
  assert.equal(resultado.sellAmount, 1000000000000000000000n);
  assert.equal(resultado.buyAmount, 618303n);
  assert.equal(resultado.feeAmount, 99990000999900009n);
  assert.equal(resultado.sellAmountFormatted, '1000');
  assert.equal(resultado.buyAmountFormatted, '0.618303');
  assert.equal(resultado.availableSellAmount, 153489433052390532125710149n);

  // Verificación de tasa efectiva calculada (~1617.33 ARS por USD₮)
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

  // Vía number
  const resNumber = await cotizar(500, { fetchFn: fakeFetch as typeof fetch });
  assert.equal(resNumber.sellAmount, 500000000000000000000n);
  assert.equal(resNumber.buyAmountFormatted, '0.309151');

  // Vía bigint
  const resBigint = await cotizar(500000000000000000000n, { fetchFn: fakeFetch as typeof fetch });
  assert.equal(resBigint.sellAmount, 500000000000000000000n);
  assert.equal(resBigint.buyAmountFormatted, '0.309151');
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
  assert.equal(resultado.buyAmountFormatted, '0');
  assert.equal(resultado.effectiveRate, 0);
  assert.equal(resultado.availableBuyAmount, 94912472527n);
});

test('cotizar: valida montos inválidos o negativos', async () => {
  await assert.rejects(
    async () => cotizar('0'),
    /El monto a cotizar debe ser mayor a 0/
  );
  await assert.rejects(
    async () => cotizar(-10),
    /El monto a cotizar debe ser mayor a 0/
  );
});

test('cotizar: maneja errores de red o HTTP de la API', async () => {
  const fakeErrorFetch = async (): Promise<Response> => {
    return new Response('Internal Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });
  };

  await assert.rejects(
    async () => cotizar('1000', { fetchFn: fakeErrorFetch as typeof fetch }),
    /Error en API de Textile FX \(500\)/
  );
});

test('cotizar: maneja error envelope retornado por Textile', async () => {
  const mockApiError = {
    error: {
      code: 'invalid_request',
      message: 'Token not supported',
    },
  };

  const fakeErrorFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(mockApiError), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    async () => cotizar('1000', { fetchFn: fakeErrorFetch as typeof fetch }),
    /Textile FX API Error: Token not supported/
  );
});
