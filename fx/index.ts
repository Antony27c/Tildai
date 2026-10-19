import { formatUnits, parseUnits } from 'viem';

/**
 * Constantes oficiales para Textile FX en Celo Mainnet
 * Fuente: https://docs.textilecredit.com/protocol/address-book.html
 */
export const CELO_CHAIN_ID = 42220;

export const CONTRACTS = {
  /** wARS: Wrapped Argentine Peso (18 decimales) */
  wARS: '0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D' as const,
  /** USDT: Tether USD en Celo (6 decimales) */
  USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as const,
  /** UniswapX LimitOrderReactor para liquidación atómica */
  limitOrderReactor: '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3' as const,
  /** Fee controller (1 bps = 0.01% fee de protocolo en Celo) */
  feeController: '0x7b005466F905DD882A959888154587fA76cd3Ea7' as const,
  /** Canonical Uniswap Permit2 */
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const,
};

export const TEXTILE_API_URL = 'https://api.textilecredit.com';

export interface Cotizacion {
  status: 'preview' | 'no_quote';
  reason?: string;
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  sellAmount: bigint;
  buyAmount: bigint;
  feeAmount: bigint;
  rateRay?: bigint;
  sellAmountFormatted: string;
  buyAmountFormatted: string;
  feeAmountFormatted: string;
  effectiveRate: number;
  availableBuyAmount?: bigint;
  availableSellAmount?: bigint;
}

export interface CotizarOptions {
  /** Función fetch inyectable para testing con respuestas falsas */
  fetchFn?: typeof fetch;
  /** URL base de la API de Textile (por defecto TEXTILE_API_URL) */
  apiBaseUrl?: string;
  /** Timeout en milisegundos para la solicitud HTTP (por defecto 8000 ms) */
  timeoutMs?: number;
}

/**
 * Convierte un monto en wARS (bigint en unidades atómicas, string o number)
 * a unidades atómicas de 18 decimales.
 */
function toAtomicWars(monto: bigint | string | number): bigint {
  if (typeof monto === 'bigint') {
    return monto;
  }
  const cleanStr = typeof monto === 'number' ? monto.toString() : monto.trim();
  return parseUnits(cleanStr, 18);
}

/**
 * Pide cotización indicativa (preview) a Textile FX para vender wARS y comprar USD₮ en Celo.
 * Usa el endpoint POST /v2/rfq/preview sin custodiar fondos ni requerir claves.
 *
 * @param monto Monto en wARS a dolarizar (ej: 1000 o "1000" para 1000 wARS, o bigint en wei)
 * @param options Opciones de configuración (timeout, inyección de fetch para pruebas)
 */
export async function cotizar(
  monto: bigint | string | number,
  options?: CotizarOptions
): Promise<Cotizacion> {
  const sellAmountAtomic = toAtomicWars(monto);
  if (sellAmountAtomic <= 0n) {
    throw new Error('El monto a cotizar debe ser mayor a 0');
  }

  const customFetch = options?.fetchFn ?? fetch;
  const baseUrl = (options?.apiBaseUrl ?? TEXTILE_API_URL).replace(/\/$/, '');
  const url = `${baseUrl}/v2/rfq/preview`;
  const timeoutMs = options?.timeoutMs ?? 8000;
  const signal = AbortSignal.timeout(timeoutMs);

  const payload = {
    chainId: CELO_CHAIN_ID,
    sellToken: CONTRACTS.wARS,
    buyToken: CONTRACTS.USDT,
    sellAmount: sellAmountAtomic.toString(),
  };

  const response = await customFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error en API de Textile FX (${response.status}): ${errorBody}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`Textile FX API Error: ${json.error.message || json.error.code}`);
  }

  const data = json.data;
  if (!data) {
    throw new Error('Respuesta inválida de Textile FX: falta campo data');
  }

  if (data.status === 'no_quote') {
    return {
      status: 'no_quote',
      reason: data.reason ?? 'Sin cotización disponible',
      sellToken: CONTRACTS.wARS,
      buyToken: CONTRACTS.USDT,
      sellAmount: sellAmountAtomic,
      buyAmount: 0n,
      feeAmount: 0n,
      sellAmountFormatted: formatUnits(sellAmountAtomic, 18),
      buyAmountFormatted: '0',
      feeAmountFormatted: '0',
      effectiveRate: 0,
      availableBuyAmount: data.availableBuyAmount ? BigInt(data.availableBuyAmount) : undefined,
      availableSellAmount: data.availableSellAmount ? BigInt(data.availableSellAmount) : undefined,
    };
  }

  const buyAmount = BigInt(data.buyAmount ?? '0');
  const feeAmount = BigInt(data.feeAmount ?? '0');
  const rateRay = data.rateRay ? BigInt(data.rateRay) : undefined;

  const sellAmountFormatted = formatUnits(sellAmountAtomic, 18);
  const buyAmountFormatted = formatUnits(buyAmount, 6);
  const feeAmountFormatted = formatUnits(feeAmount, 18);

  // effectiveRate en ARS por 1 USDT (cuántos wARS cuesta cada USD₮)
  const sellNum = parseFloat(sellAmountFormatted);
  const buyNum = parseFloat(buyAmountFormatted);
  const effectiveRate = buyNum > 0 ? sellNum / buyNum : 0;

  return {
    status: 'preview',
    sellToken: CONTRACTS.wARS,
    buyToken: CONTRACTS.USDT,
    sellAmount: sellAmountAtomic,
    buyAmount,
    feeAmount,
    rateRay,
    sellAmountFormatted,
    buyAmountFormatted,
    feeAmountFormatted,
    effectiveRate,
    availableBuyAmount: data.availableBuyAmount ? BigInt(data.availableBuyAmount) : undefined,
    availableSellAmount: data.availableSellAmount ? BigInt(data.availableSellAmount) : undefined,
  };
}
