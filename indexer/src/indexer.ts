import { parseAbi } from 'viem';
import { eachChunk, withRetry, type RetryOpts } from './rpc.ts';

export const WARS = '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d';
export const WARS_DECIMALS = 18;

export const [transferEvent] = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
export const [vaultCreatedEvent] = parseAbi(['event VaultCreated(address indexed vault, address indexed owner)']);

export type Log = {
  address: string;
  blockNumber: bigint | null;
  transactionHash: string | null;
  logIndex: number | null;
  args: { from?: string; to?: string; value?: bigint; vault?: string; owner?: string };
};

// Solo lectura: lo mínimo que usamos de un PublicClient de viem. Un falso lo reemplaza en tests.
export interface ChainReader {
  getBlockNumber(): Promise<bigint>;
  getLogs(p: {
    address: string;
    event: typeof transferEvent | typeof vaultCreatedEvent;
    args?: { to: string[] };
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Log[]>;
}

export type Sale = { id: string; vault: string; amount: bigint; createdBlock: bigint; status: 'pendiente' | 'cobrada'; paymentId?: string; txHash?: string };
export type Payment = { id: string; vault: string; from: string; amount: bigint; block: bigint; txHash: string; saleId?: string };

// shortcut: store en memoria, se pierde al reiniciar; cambiar por DB antes de usarlo con plata real.
export class Store {
  sales = new Map<string, Sale>();
  payments = new Map<string, Payment>();
  vaults = new Map<string, string>(); // vault -> dueño
  cursor: bigint | null = null; // próximo bloque a leer de Transfer
  vaultCursor: bigint | null = null; // próximo bloque a leer de VaultCreated

  addSale(s: { id: string; vault: string; amount: bigint; createdBlock: bigint }): Sale {
    if (this.sales.has(s.id)) throw new Error(`venta duplicada: ${s.id}`);
    if (s.amount <= 0n) throw new Error('el monto debe ser positivo');
    const sale: Sale = { ...s, vault: s.vault.toLowerCase(), status: 'pendiente' };
    this.sales.set(s.id, sale);
    return sale;
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
  save?: (store: Store) => Promise<void>; // persistencia; si falla, el error sube (poll lo registra y devuelve ok:false)
  onError?: (e: unknown) => void;
};

// Cruza un pago con la venta pendiente más vieja del mismo vault y monto exacto, creada en o antes del bloque del pago.
// Las ventas atadas a una tx (x402) solo las cobra esa tx, ver settleByTx.
function reconcile(store: Store, p: Payment): boolean {
  if (p.saleId) return false;
  for (const s of store.sales.values()) {
    if (s.status === 'pendiente' && !s.txHash && s.vault === p.vault && s.amount === p.amount && p.block >= s.createdBlock) {
      claim(s, p);
      return true;
    }
  }
  return false;
}

function claim(s: Sale, p: Payment) {
  s.status = 'cobrada';
  s.paymentId = p.id;
  p.saleId = s.id;
}

// Cobra la venta solo si el indexador ya vio, confirmado, un Transfer de esa tx al vault de la venta por el monto exacto y sin dueño.
function settleByTx(store: Store, s: Sale): boolean {
  if (s.status !== 'pendiente' || !s.txHash) return false;
  for (const p of store.payments.values()) {
    if (p.txHash === s.txHash && !p.saleId && p.vault === s.vault && p.amount === s.amount && p.block >= s.createdBlock) {
      claim(s, p);
      return true;
    }
  }
  return false;
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);

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
            if (!p) {
              p = { id, vault: dest.toLowerCase(), from: (src ?? '').toLowerCase(), amount: value, block: l.blockNumber, txHash: l.transactionHash.toLowerCase() };
              store.payments.set(id, p);
              newPayments++;
            }
            if (reconcile(store, p)) matched++;
          }
        }
        store.cursor = max(store.cursor ?? 0n, b + 1n);
      });
      for (const s of store.sales.values()) if (settleByTx(store, s)) matched++;
      await o.save?.(store);
      return { ok: true, from, to: safe, newVaults, newPayments, matched };
    } catch (error) {
      log(error);
      return { ok: false, error };
    }
  }

  // Reintenta en el próximo tick; para con la señal.
  async function watch(ms: number, signal: AbortSignal) {
    while (!signal.aborted) {
      await pollOnce();
      await new Promise((r) => setTimeout(r, ms));
    }
  }

  // Si el RPC falla no se crea la venta: sin bloque de creación no se puede conciliar con seguridad.
  async function createSale(s: { id: string; vault: string; amount: bigint }): Promise<Sale> {
    const sale = store.addSale({ ...s, createdBlock: await rpc(() => client.getBlockNumber()) });
    await o.save?.(store);
    return sale;
  }

  // Pago x402: el hash lo informa el facilitador pero no se le cree. Queda pendiente hasta que un poll vea el Transfer confirmado.
  // shortcut: una tx equivocada deja la venta pendiente para siempre sin aviso; agregar vencimiento y alerta al dueño.
  async function markPaidByTx(saleId: string, txHash: string): Promise<Sale['status']> {
    const s = store.sales.get(saleId);
    if (!s) throw new Error(`venta inexistente: ${saleId}`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error(`hash de tx inválido: ${txHash}`);
    const tx = txHash.toLowerCase();
    if (s.status === 'cobrada') {
      if (store.payments.get(s.paymentId!)?.txHash === tx) return 'cobrada';
      throw new Error(`la venta ${saleId} ya está cobrada con otro pago`);
    }
    s.txHash = tx;
    settleByTx(store, s);
    await o.save?.(store);
    return s.status;
  }

  return { pollOnce, watch, createSale, markPaidByTx };
}
