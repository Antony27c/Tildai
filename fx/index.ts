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
  /** Operator VaultOrderExecutor en Celo */
  vaultOrderExecutor: '0x01b006d5c687bde182aa36F542f1f014144742e2' as const,
  /** Fee controller (1 bps = 0.01% fee de protocolo en Celo) */
  feeController: '0x7b005466F905DD882A959888154587fA76cd3Ea7' as const,
  /** Canonical Uniswap Permit2 */
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const,
};

/** Spenders y targets oficiales autorizados para swaps de Textile en Celo */
export const ALLOWED_TEXTILE_SPENDERS = [
  CONTRACTS.limitOrderReactor.toLowerCase(),
  CONTRACTS.vaultOrderExecutor.toLowerCase(),
];

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
 * Argumentos formateados para llamar a TildaiVault.swap
 */
export interface SwapArgs {
  spender: `0x${string}`;
  target: `0x${string}`;
  data: `0x${string}`;
  amountIn: bigint;
  minOut: bigint;
  expiresAt: number;
}

export interface CotizarFirmeParams {
  monto: bigint | string | number;
  vaultAddress: `0x${string}`;
  maxRate: bigint | number;
  previewRate?: number;
}

export interface CotizarFirmeOptions {
  /** API key de partner Textile (por defecto process.env.TEXTILE_API_KEY) */
  apiKey?: string;
  /** Función fetch inyectable para testing con respuestas falsas */
  fetchFn?: typeof fetch;
  /** URL base de la API de Textile (por defecto TEXTILE_API_URL) */
  apiBaseUrl?: string;
  /** Timeout en milisegundos (por defecto 75000 ms / 75 s) */
  timeoutMs?: number;
  /** Timestamp actual en ms (para pruebas deterministas de expiresAt) */
  nowMs?: number;
  /** Tasa preview previa opcional cuando se usa firma con parámetros posicionales */
  previewRate?: number;
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

/**
 * Pide cotización firme a Textile FX (POST /v2/rfq/request) con API Key de partner,
 * valida rigurosamente las condiciones de seguridad y convierte la orden en los argumentos
 * listos para llamar a TildaiVault.swap().
 */
export async function cotizarFirme(
  params: CotizarFirmeParams,
  options?: CotizarFirmeOptions
): Promise<SwapArgs>;
export async function cotizarFirme(
  monto: bigint | string | number,
  vaultAddress: `0x${string}`,
  maxRate: bigint | number,
  options?: CotizarFirmeOptions & { previewRate?: number }
): Promise<SwapArgs>;
export async function cotizarFirme(
  montoOrParams: bigint | string | number | CotizarFirmeParams,
  vaultAddressOrOptions?: `0x${string}` | CotizarFirmeOptions,
  maxRateArg?: bigint | number,
  optionsArg?: CotizarFirmeOptions & { previewRate?: number }
): Promise<SwapArgs> {
  let monto: bigint | string | number;
  let vaultAddress: `0x${string}`;
  let maxRate: bigint | number;
  let previewRate: number | undefined;
  let options: CotizarFirmeOptions | undefined;

  if (typeof montoOrParams === 'object' && montoOrParams !== null && !('trim' in montoOrParams) && typeof montoOrParams !== 'bigint') {
    monto = montoOrParams.monto;
    vaultAddress = montoOrParams.vaultAddress;
    maxRate = montoOrParams.maxRate;
    previewRate = montoOrParams.previewRate;
    options = vaultAddressOrOptions as CotizarFirmeOptions | undefined;
  } else {
    monto = montoOrParams as bigint | string | number;
    vaultAddress = vaultAddressOrOptions as `0x${string}`;
    maxRate = maxRateArg!;
    options = optionsArg;
    previewRate = options?.previewRate;
  }

  // 1. Obtener API Key (nunca loguearla ni incluirla en mensajes de error)
  const apiKey = options?.apiKey ?? process.env.TEXTILE_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('TEXTILE_API_KEY no configurada');
  }

  const sellAmountAtomic = toAtomicWars(monto);
  if (sellAmountAtomic <= 0n) {
    throw new Error('El monto a cotizar debe ser mayor a 0');
  }

  if (!vaultAddress || !vaultAddress.startsWith('0x') || vaultAddress.length !== 42) {
    throw new Error('Dirección de vault inválida');
  }

  const customFetch = options?.fetchFn ?? fetch;
  const baseUrl = (options?.apiBaseUrl ?? TEXTILE_API_URL).replace(/\/$/, '');
  const url = `${baseUrl}/v2/rfq/request`;
  // Timeout de 75 s como dice la doc oficial
  const timeoutMs = options?.timeoutMs ?? 75000;
  const signal = AbortSignal.timeout(timeoutMs);

  const payload = {
    chainId: CELO_CHAIN_ID,
    sellToken: CONTRACTS.wARS,
    buyToken: CONTRACTS.USDT,
    sellAmount: sellAmountAtomic.toString(),
    taker: vaultAddress,
  };

  let response: Response;
  try {
    response = await customFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err: any) {
    // Sanitizar error de red para asegurar que la key nunca aparezca
    const safeMsg = (err?.message || 'Error de red').replace(new RegExp(apiKey, 'g'), '***');
    if (err?.name === 'TimeoutError' || /timeout|aborted/i.test(err?.message)) {
      const timeoutErr = new Error(`Timeout al solicitar cotización firme a Textile FX: ${safeMsg}`);
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }
    throw new Error(`Error al conectar con Textile RFQ: ${safeMsg}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    const safeBody = errorBody.replace(new RegExp(apiKey, 'g'), '***');
    throw new Error(`Error en API de Textile FX (${response.status}): ${safeBody}`);
  }

  const json = await response.json();
  if (json.error) {
    const errorMsg = (json.error.message || json.error.code || 'Error desconocido').replace(new RegExp(apiKey, 'g'), '***');
    throw new Error(`Textile FX API Error: ${errorMsg}`);
  }

  const data = json.data;
  if (!data) {
    throw new Error('Respuesta inválida de Textile FX: falta campo data');
  }

  // 2. Validación y rechazo: ante no_quote, devolver motivo sin tasa por defecto
  if (data.status === 'no_quote') {
    throw new Error(`Cotización rechazada: ${data.reason || 'sin cotización disponible (no_quote)'}`);
  }

  // Resolver spender y target (swap.to)
  const rawSpender = (data.spender || data.transactions?.approval?.spender || data.transactions?.approval?.to || '');
  const rawTarget = (data.transactions?.swap?.to || '');
  const swapData = data.transactions?.swap?.data;

  const spender = rawSpender.toLowerCase() as `0x${string}`;
  const target = rawTarget.toLowerCase() as `0x${string}`;

  // Validar contratos autorizados en Celo mainnet
  if (!ALLOWED_TEXTILE_SPENDERS.includes(spender)) {
    throw new Error(`Cotización rechazada: spender ${rawSpender} no está autorizado en Celo`);
  }
  if (!ALLOWED_TEXTILE_SPENDERS.includes(target)) {
    throw new Error(`Cotización rechazada: target ${rawTarget} no está autorizado en Celo`);
  }
  if (!swapData || typeof swapData !== 'string' || !swapData.startsWith('0x')) {
    throw new Error('Cotización rechazada: transactions.swap.data ausente o inválida');
  }

  // Validar expiresAt (mínimo 15 segundos restantes)
  const rawExpiresAt = data.expiresAt;
  if (rawExpiresAt === undefined || rawExpiresAt === null) {
    throw new Error('Cotización rechazada: falta expiresAt');
  }

  let expiresAtMs: number;
  if (typeof rawExpiresAt === 'number') {
    expiresAtMs = rawExpiresAt < 1e11 ? rawExpiresAt * 1000 : rawExpiresAt;
  } else if (typeof rawExpiresAt === 'string') {
    expiresAtMs = Date.parse(rawExpiresAt);
  } else {
    throw new Error('Cotización rechazada: expiresAt con formato inválido');
  }

  const nowMs = options?.nowMs ?? Date.now();
  const remainingSeconds = (expiresAtMs - nowMs) / 1000;
  if (remainingSeconds < 15) {
    throw new Error(`Cotización rechazada: orden expira en ${remainingSeconds.toFixed(1)}s (menos de 15s) o ya expiró`);
  }

  // Validar takerPays: no puede superar lo pedido
  const takerPays = BigInt(data.takerPays ?? data.sellAmount ?? '0');
  if (takerPays > sellAmountAtomic) {
    throw new Error(`Cotización rechazada: takerPays (${takerPays}) supera el monto pedido (${sellAmountAtomic})`);
  }
  if (takerPays <= 0n) {
    throw new Error('Cotización rechazada: takerPays inválido');
  }

  const buyAmount = BigInt(data.buyAmount ?? '0');
  if (buyAmount <= 0n) {
    throw new Error('Cotización rechazada: buyAmount es 0');
  }

  // Validar tasa wARS por USD₮ contra maxRate
  const sellFormatted = parseFloat(formatUnits(takerPays, 18));
  const buyFormatted = parseFloat(formatUnits(buyAmount, 6));
  const firmRate = sellFormatted / buyFormatted;

  let isRateExceeded = false;
  let maxRateDisplay = '';
  if (typeof maxRate === 'bigint') {
    if (maxRate > 10n ** 12n) {
      // maxRate en wei por USD₮ entero (formato TildaiVault)
      const rateWei = (takerPays * 10n ** 6n) / buyAmount;
      isRateExceeded = rateWei > maxRate;
      maxRateDisplay = formatUnits(maxRate, 18);
    } else {
      isRateExceeded = firmRate > Number(maxRate);
      maxRateDisplay = maxRate.toString();
    }
  } else {
    isRateExceeded = firmRate > maxRate;
    maxRateDisplay = maxRate.toString();
  }

  if (isRateExceeded) {
    throw new Error(`Cotización rechazada: tasa ${firmRate.toFixed(2)} wARS/USDT supera maxRate ${maxRateDisplay}`);
  }

  // Validar que no empeore más de 1% respecto a la cotización previa preview
  if (previewRate !== undefined && previewRate > 0) {
    const deviation = (firmRate - previewRate) / previewRate;
    if (deviation > 0.01) {
      throw new Error(`Cotización rechazada: tasa ${firmRate.toFixed(2)} es ${(deviation * 100).toFixed(2)}% peor que preview (${previewRate.toFixed(2)})`);
    }
  }

  // 3. Devolver argumentos listos para TildaiVault.swap
  const expiresAtSec = Math.floor(expiresAtMs / 1000);

  return {
    spender: rawSpender as `0x${string}`,
    target: rawTarget as `0x${string}`,
    data: swapData as `0x${string}`,
    amountIn: takerPays,
    minOut: buyAmount,
    expiresAt: expiresAtSec,
  };
}
