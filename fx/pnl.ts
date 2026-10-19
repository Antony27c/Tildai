import { parseAbiItem } from 'viem';
import { cotizar, type CotizarOptions } from './index.ts';

/**
 * Evento Swapped de TildaiVault:
 * event Swapped(bytes32 indexed opId, Bucket from, uint256 warsSpent, uint256 usdtReceived)
 */
export const SWAPPED_EVENT = parseAbiItem(
  'event Swapped(bytes32 indexed opId, uint8 from, uint256 warsSpent, uint256 usdtReceived)'
);

export interface DolarizacionEjecutada {
  txHash?: `0x${string}` | string;
  timestamp?: number;
  warsSpent: bigint;    // wei (18 decimales)
  usdtReceived: bigint; // unidades atómicas de USD₮ (6 decimales)
  opId?: `0x${string}` | string;
  fromBucket?: number;
}

export interface PnlResultado {
  /** Volumen total ejecutado en wARS (wei) */
  totalWarsSpent: bigint;
  /** Volumen total ejecutado en USD₮ (6 decimales) */
  totalUsdtReceived: bigint;
  /** Cantidad de operaciones de dolarización ejecutadas */
  count: number;
  /** Tasa promedio ponderada de compra (wei de wARS por 1 USD₮ entero) */
  averageRateWei: bigint;
  /** Tasa actual utilizada (wei de wARS por 1 USD₮ entero), si está disponible */
  currentRateWei?: bigint;
  /** Valor actual en wARS (wei) de los USD₮ comprados */
  currentValueWars?: bigint;
  /** P&L en pesos (wei) contra haberse quedado en wARS (positivo si el dólar subió) */
  pnlWars?: bigint;
  /** Estado del cálculo */
  status: 'ok' | 'sin_tasa_actual';
}

/**
 * Función pura que calcula el P&L y métricas de dolarización para el track de Textile.
 * Todo el cálculo se realiza estrictamente con bigint, sin usar floats.
 *
 * @param swaps Lista de dolarizaciones ejecutadas
 * @param currentRateWei Tasa actual de wARS por USD₮ (en wei por USD₮ entero).
 *                       Si es undefined, el resultado indica 'sin_tasa_actual' y no calcula P&L.
 */
export function calcularPnl(
  swaps: DolarizacionEjecutada[],
  currentRateWei?: bigint
): PnlResultado {
  let totalWarsSpent = 0n;
  let totalUsdtReceived = 0n;

  for (const swap of swaps) {
    totalWarsSpent += swap.warsSpent;
    totalUsdtReceived += swap.usdtReceived;
  }

  // Tasa promedio ponderada: (totalWarsSpent * 10^6) / totalUsdtReceived
  const averageRateWei =
    totalUsdtReceived > 0n
      ? (totalWarsSpent * 10n ** 6n) / totalUsdtReceived
      : 0n;

  if (currentRateWei === undefined || currentRateWei === null) {
    return {
      totalWarsSpent,
      totalUsdtReceived,
      count: swaps.length,
      averageRateWei,
      status: 'sin_tasa_actual',
    };
  }

  // Si la lista está vacía, el valor actual y P&L son 0
  if (totalUsdtReceived === 0n) {
    return {
      totalWarsSpent: 0n,
      totalUsdtReceived: 0n,
      count: 0,
      averageRateWei: 0n,
      currentRateWei,
      currentValueWars: 0n,
      pnlWars: 0n,
      status: 'ok',
    };
  }

  // Valor actual en pesos de los USD₮ comprados: (totalUsdtReceived * currentRateWei) / 10^6
  const currentValueWars = (totalUsdtReceived * currentRateWei) / 10n ** 6n;

  // P&L en pesos contra haberse quedado en wARS: valor actual - pesos gastados originalmente
  // Positivo si el dólar subió
  const pnlWars = currentValueWars - totalWarsSpent;

  return {
    totalWarsSpent,
    totalUsdtReceived,
    count: swaps.length,
    averageRateWei,
    currentRateWei,
    currentValueWars,
    pnlWars,
    status: 'ok',
  };
}

export interface ObtenerSwapsParams {
  client: {
    getLogs: (params: any) => Promise<any[]>;
  };
  vaultAddresses: `0x${string}`[];
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize?: bigint;
}

/**
 * Lee los eventos Swapped(opId, from, warsSpent, usdtReceived) de una lista de vaults con viem,
 * consultando por tramos (chunking) para respetar los límites de bloques de los RPCs.
 */
export async function obtenerSwapsOnchain(
  params: ObtenerSwapsParams
): Promise<DolarizacionEjecutada[]> {
  const { client, vaultAddresses, fromBlock, toBlock } = params;
  const chunkSize = params.chunkSize ?? 5000n;

  if (vaultAddresses.length === 0) {
    return [];
  }

  const swaps: DolarizacionEjecutada[] = [];
  let currentFrom = fromBlock;

  while (currentFrom <= toBlock) {
    const currentTo =
      currentFrom + chunkSize - 1n > toBlock ? toBlock : currentFrom + chunkSize - 1n;

    const logs = await client.getLogs({
      address: vaultAddresses.length === 1 ? vaultAddresses[0] : vaultAddresses,
      event: SWAPPED_EVENT,
      fromBlock: currentFrom,
      toBlock: currentTo,
    });

    for (const log of logs) {
      if (log.args && log.args.warsSpent !== undefined && log.args.usdtReceived !== undefined) {
        swaps.push({
          txHash: log.transactionHash,
          opId: log.args.opId,
          fromBucket: log.args.from !== undefined ? Number(log.args.from) : undefined,
          warsSpent: BigInt(log.args.warsSpent),
          usdtReceived: BigInt(log.args.usdtReceived),
        });
      }
    }

    currentFrom = currentTo + 1n;
  }

  return swaps;
}

// shortcut: values USD₮ at Textile's ask (wARS -> USD₮) because the bid is 0 today; it is a reference value, not
// what selling the USD₮ would pay. Switch to the bid (USD₮ -> wARS preview) once Textile has buyers.
/**
 * Obtiene la tasa actual wARS por USD₮ (en wei por USD₮ entero) consultando cotizar() (preview).
 * Si la cotización falla o responde no_quote, devuelve undefined (NUNCA una tasa por defecto).
 */
export async function obtenerTasaActualPreview(
  options?: CotizarOptions
): Promise<bigint | undefined> {
  try {
    // Cotizar 1000 wARS como referencia para obtener la tasa spot actual
    const quote = await cotizar('1000', options);
    if (quote.status !== 'preview' || quote.buyAmount <= 0n) {
      return undefined;
    }
    // Tasa en wei por 1 USD₮ entero: (sellAmount * 10^6) / buyAmount
    return (quote.sellAmount * 10n ** 6n) / quote.buyAmount;
  } catch (err) {
    console.error('[fx] no se pudo obtener la tasa actual para el P&L', err);
    return undefined;
  }
}

/**
 * Función de conveniencia que obtiene la tasa actual mediante cotizar() y calcula el P&L.
 * Si cotizar() falla, reporta status 'sin_tasa_actual' sin usar tasas inventadas.
 */
export async function calcularPnlConTasaActual(
  swaps: DolarizacionEjecutada[],
  previewOptions?: CotizarOptions
): Promise<PnlResultado> {
  const currentRateWei = await obtenerTasaActualPreview(previewOptions);
  return calcularPnl(swaps, currentRateWei);
}
