import { setTimeout as sleep } from 'node:timers/promises';
import { parseAbi } from 'viem';
import { eachChunk, withRetry, type RetryOpts } from './rpc.ts';

export const WARS = '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d';
export const WARS_DECIMALS = 18;

export const [transferEvent] = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
export const [vaultCreatedEvent] = parseAbi(['event VaultCreated(address indexed vault, address indexed owner)']);

export type Log = {
  address: string;
  blockNumber: bigint | null;
  // Timestamp del bloque en segundos: lo incluyen op-geth/Forno en eth_getLogs (viem lo parsea a bigint).
  blockTimestamp?: bigint | null;
  transactionHash: string | null;
  logIndex: number | null;
  args: { from?: string; to?: string; value?: bigint; vault?: string; owner?: string };
};

// Solo lectura: lo mínimo que usamos de un PublicClient de viem. Un falso lo reemplaza en tests.
export interface ChainReader {
  getBlockNumber(): Promise<bigint>;
  getBlock(p: { blockNumber: bigint }): Promise<{ timestamp: bigint }>; // timestamp en segundos, como la cadena
  getLogs(p: {
    address: string;
    event: typeof transferEvent | typeof vaultCreatedEvent;
    args?: { to: string[] };
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Log[]>;
}

export type Sale = { id: string; vault: string; amount: bigint; createdBlock: bigint; createdAt: number; status: 'pendiente' | 'cobrada'; paymentId?: string; txHashes: string[] };
export type Payment = { id: string; vault: string; from: string; amount: bigint; block: bigint; txHash: string; timestamp?: number; timestampUnavailable?: boolean; saleId?: string };
// Eventos para el agente: seq crece de a 1 y es el cursor de GET /events.
export type StoreEvent = { seq: number; type: 'venta_cobrada' | 'pago_sin_venta'; paymentId: string; saleId?: string };

// shortcut: store en memoria volcado a JSON por save() tras cada cambio; cambiar por DB antes de usarlo con plata real.
export class Store {
  sales = new Map<string, Sale>();
  payments = new Map<string, Payment>();
  vaults = new Map<string, string>(); // vault -> dueño
  events: StoreEvent[] = [];
  cursor: bigint | null = null; // próximo bloque a leer de Transfer
  vaultCursor: bigint | null = null; // próximo bloque a leer de VaultCreated

  addEvent(type: StoreEvent['type'], paymentId: string, saleId?: string) {
    this.events.push({ seq: this.events.length + 1, type, paymentId, ...(saleId && { saleId }) });
  }

  addSale(s: { id: string; vault: string; amount: bigint; createdBlock: bigint; createdAt: number }): Sale {
    if (this.sales.has(s.id)) throw new IndexerError('conflict', `venta duplicada: ${s.id}`);
    if (s.amount <= 0n) throw new IndexerError('invalid', 'el monto debe ser positivo');
    const sale: Sale = { ...s, vault: s.vault.toLowerCase(), status: 'pendiente', txHashes: [] };
    this.sales.set(s.id, sale);
    return sale;
  }
}

export class IndexerError extends Error {
  code: 'not_found' | 'invalid' | 'conflict';
  constructor(code: 'not_found' | 'invalid' | 'conflict', message: string) {
    super(message);
    this.code = code;
  }
}

export function parseWars(x: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(x.trim());
  if (!m) throw new Error(`monto inválido: ${x}`);
  return BigInt(m[1] + (m[2] ?? '').padEnd(WARS_DECIMALS, '0'));
}

export type PollResult =
  | { ok: true; from: bigint; to: bigint; newVaults: number; newPayments: number; matched: number }
  | { ok: false; error: unknown };

export type IndexerOpts = {
  client: ChainReader;
  // Nodo de archivo opcional: solo se usa para la fecha de bloques que el RPC principal ya podó.
  archiveClient?: ChainReader;
  store: Store;
  factory: string;
  token?: string;
  startBlock: bigint; // bloque de deploy de la factory
  confirmations?: bigint;
  maxRange?: bigint;
  // Bloques que se vuelven a leer en cada pasada. Un nodo atrasado puede devolver vacío para bloques
  // que ya están en la cadena; como todo es idempotente, releer es gratis.
  rescan?: bigint;
  retries?: number;
  backoffMs?: number;
  sleep?: RetryOpts['sleep'];
  now?: () => number; // ms, para el timestamp de creación de las ventas
  save?: (store: Store) => Promise<void>; // persistencia; si falla, el error sube (poll lo registra y devuelve ok:false)
  onError?: (e: unknown) => void;
};

// Cruza un pago con la venta pendiente más vieja del mismo vault y monto exacto, creada en o antes del bloque del pago.
// Una venta con hashes x402 informados también la cobra un pago real que coincide: un hash ajeno no la puede trabar.
// Pero si el txHash del pago fue informado para una venta, esa es la suya aunque haya otra más vieja del mismo monto.
function reconcile(store: Store, p: Payment): boolean {
  if (p.saleId) return false;
  const fits = (s: Sale) => s.status === 'pendiente' && s.vault === p.vault && s.amount === p.amount && p.block >= s.createdBlock;
  for (const s of store.sales.values()) {
    if (fits(s) && s.txHashes.includes(p.txHash)) {
      claim(store, s, p);
      return true;
    }
  }
  for (const s of store.sales.values()) {
    if (fits(s)) {
      claim(store, s, p);
      return true;
    }
  }
  return false;
}

function claim(store: Store, s: Sale, p: Payment) {
  store.addEvent('venta_cobrada', p.id, s.id);
  s.status = 'cobrada';
  s.paymentId = p.id;
  p.saleId = s.id;
}

// Cobra la venta solo si el indexador ya vio, confirmado, un Transfer de alguna de las tx informadas al vault de la venta por el monto exacto y sin dueño.
function settleByTx(store: Store, s: Sale): boolean {
  if (s.status !== 'pendiente' || !s.txHashes.length) return false;
  for (const p of store.payments.values()) {
    if (s.txHashes.includes(p.txHash) && !p.saleId && p.vault === s.vault && p.amount === s.amount && p.block >= s.createdBlock) {
      claim(store, s, p);
      return true;
    }
  }
  return false;
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);

// Texto del error de RPC junto, para buscar patrones; viem pone el detalle útil en .details.
const errText = (e: unknown) =>
  e && typeof e === 'object'
    ? [(e as { details?: string }).details, (e as { message?: string }).message, (e as { shortMessage?: string }).shortMessage].filter(Boolean).join(' ')
    : String(e);
const brief = (e: unknown) => errText(e).split('\n')[0];
// 'behind head'/'missing trie node'/'header not found': el nodo podó el bloque; es permanente, no transitorio.
const isPruned = (e: unknown) => /behind head|missing trie node|header not found|pruned/i.test(errText(e));

export function createIndexer(o: IndexerOpts) {
  const { store, client } = o;
  const token = (o.token ?? WARS).toLowerCase();
  const factory = o.factory.toLowerCase();
  const confirmations = o.confirmations ?? 5n;
  const maxRange = o.maxRange ?? 10_000n;
  const rescan = o.rescan ?? 50n;
  const retry: RetryOpts = { retries: o.retries ?? 3, backoffMs: o.backoffMs ?? 500, sleep: o.sleep };
  const log = o.onError ?? ((e: unknown) => console.error('indexer:', e));
  const rpc = <T>(fn: () => Promise<T>) => withRetry(fn, retry);

  async function discoverVaults(safe: bigint): Promise<number> {
    const from = max(o.startBlock, (store.vaultCursor ?? o.startBlock) - rescan);
    let found = 0;
    await eachChunk(from, safe, maxRange, async (a, b) => {
      const logs = await rpc(() => client.getLogs({ address: factory, event: vaultCreatedEvent, fromBlock: a, toBlock: b }));
      for (const l of logs) {
        const { vault, owner } = l.args;
        if (l.address.toLowerCase() !== factory || !vault || !owner) continue;
        if (!store.vaults.has(vault.toLowerCase())) found++;
        store.vaults.set(vault.toLowerCase(), owner.toLowerCase());
      }
      store.vaultCursor = max(store.vaultCursor ?? 0n, b + 1n);
    });
    return found;
  }

  // Nunca lanza: ante cualquier falla el cursor no avanza más allá de lo leído y las ventas siguen pendientes.
  async function pollOnce(): Promise<PollResult> {
    try {
      const safe = (await rpc(() => client.getBlockNumber())) - confirmations;
      const newVaults = await discoverVaults(safe);
      const from = max(o.startBlock, (store.cursor ?? o.startBlock) - rescan);
      let newPayments = 0;
      let matched = 0;
      // Fecha del bloque en ms: RPC normal; si el nodo ya podó el bloque, el RPC de archivo (si hay).
      // null = podado de los dos lados: el pago se marca sin fecha, jamás se estima por número de bloque.
      async function blockTs(b: bigint): Promise<number | null> {
        try {
          return Number((await rpc(() => client.getBlock({ blockNumber: b }))).timestamp) * 1000;
        } catch (e) {
          if (!isPruned(e)) throw e;
          if (!o.archiveClient) {
            log(`indexer: bloque ${b} podado en el RPC (${brief(e)})`);
            return null;
          }
          try {
            return Number((await rpc(() => o.archiveClient!.getBlock({ blockNumber: b }))).timestamp) * 1000;
          } catch (e2) {
            if (!isPruned(e2)) throw e2;
            log(`indexer: bloque ${b} podado también en el RPC de archivo (${brief(e2)})`);
            return null;
          }
        }
      }

      // Pone fecha a los pagos que aún no la tienen: una lectura por bloque, se guarda en memoria y luego en disco.
      // Un error transitorio corta la tanda y reintenta en el próximo poll; un bloque podado marca al pago
      // como sin fecha (permanente) para que GET /payments lo informe aparte en vez de fallar siempre.
      async function fillTimestamps() {
        const blocks = new Map<bigint, number | null>();
        for (const p of store.payments.values()) {
          if (p.timestamp != null || p.timestampUnavailable) continue;
          if (!blocks.has(p.block)) {
            try {
              blocks.set(p.block, await blockTs(p.block));
            } catch (e) {
              log(`indexer: getBlock ${p.block} falló, reintenta en el próximo poll: ${brief(e)}`);
              break;
            }
          }
          const ts = blocks.get(p.block);
          if (ts != null) p.timestamp = ts;
          else p.timestampUnavailable = true;
        }
      }

      await eachChunk(from, safe, maxRange, async (a, b) => {
        if (store.vaults.size) {
          const logs = await rpc(() =>
            client.getLogs({ address: token, event: transferEvent, args: { to: [...store.vaults.keys()] }, fromBlock: a, toBlock: b }),
          );
          for (const l of logs) {
            const { to: dest, from: src, value } = l.args;
            if (l.address.toLowerCase() !== token || l.blockNumber == null || !l.transactionHash || l.logIndex == null) continue;
            if (!dest || !store.vaults.has(dest.toLowerCase()) || typeof value !== 'bigint' || value <= 0n) continue;
            const id = `${l.transactionHash.toLowerCase()}:${l.logIndex}`;
            let p = store.payments.get(id);
            const isNew = !p;
            if (!p) {
              p = { id, vault: dest.toLowerCase(), from: (src ?? '').toLowerCase(), amount: value, block: l.blockNumber, txHash: l.transactionHash.toLowerCase() };
              store.payments.set(id, p);
              newPayments++;
            }
            // op-geth/Forno incluye blockTimestamp en el log: fecha gratis, sin getBlock.
            if (p.timestamp == null && l.blockTimestamp != null) p.timestamp = Number(l.blockTimestamp) * 1000;
            if (reconcile(store, p)) matched++;
            else if (isNew) store.addEvent('pago_sin_venta', p.id);
          }
        }
        store.cursor = max(store.cursor ?? 0n, b + 1n);
      });
      for (const s of store.sales.values()) if (settleByTx(store, s)) matched++;
      await fillTimestamps();
      await o.save?.(store);
      return { ok: true, from, to: safe, newVaults, newPayments, matched };
    } catch (error) {
      log(error);
      return { ok: false, error };
    }
  }

  // Reintenta en el próximo tick; para con la señal, también a mitad del sleep.
  async function watch(ms: number, signal: AbortSignal) {
    while (!signal.aborted) {
      await pollOnce();
      await sleep(ms, undefined, { signal }).catch(() => {}); // AbortError al abortar: el while sale
    }
  }

  // Si el RPC falla no se crea la venta: sin bloque de creación no se puede conciliar con seguridad.
  async function createSale(s: { id: string; vault: string; amount: bigint }): Promise<Sale> {
    const sale = store.addSale({ ...s, createdBlock: await rpc(() => client.getBlockNumber()), createdAt: (o.now ?? Date.now)() });
    await o.save?.(store);
    return sale;
  }

  // Pago x402: el hash lo informa el facilitador pero no se le cree. Queda pendiente hasta que un poll vea el Transfer confirmado.
  // Se guardan hasta 5 hashes sin repetir: un hash erróneo o ajeno no tapa al pago bueno.
  // shortcut: una venta cuyo pago nunca llega queda pendiente para siempre sin aviso; agregar vencimiento y alerta al dueño.
  async function markPaidByTx(saleId: string, txHash: string): Promise<Sale['status']> {
    const s = store.sales.get(saleId);
    if (!s) throw new IndexerError('not_found', `venta inexistente: ${saleId}`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new IndexerError('invalid', `hash de tx inválido: ${txHash}`);
    const tx = txHash.toLowerCase();
    if (s.status === 'cobrada') {
      if (store.payments.get(s.paymentId!)?.txHash === tx) return 'cobrada';
      throw new IndexerError('conflict', `la venta ${saleId} ya está cobrada con otro pago`);
    }
    if (s.txHashes.includes(tx)) return s.status;
    if (s.txHashes.length >= 5) throw new IndexerError('conflict', `la venta ${saleId} ya tiene 5 tx informadas`);
    s.txHashes.push(tx);
    settleByTx(store, s);
    await o.save?.(store);
    return s.status;
  }

  return { pollOnce, watch, createSale, markPaidByTx };
}
