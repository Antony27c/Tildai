export const WARS = '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d';
export const WARS_DECIMALS = 18;

export const transferEvent = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { type: 'address', name: 'from', indexed: true },
    { type: 'address', name: 'to', indexed: true },
    { type: 'uint256', name: 'value', indexed: false },
  ],
} as const;

export type TransferLog = {
  address: string;
  blockNumber: bigint | null;
  transactionHash: string | null;
  logIndex: number | null;
  args: { from?: string; to?: string; value?: bigint };
};

// Solo lectura: lo mínimo que usamos de un PublicClient de viem. Un falso lo reemplaza en tests.
export interface ChainReader {
  getBlockNumber(): Promise<bigint>;
  getLogs(p: { address: string; event: typeof transferEvent; args: { to: string[] }; fromBlock: bigint; toBlock: bigint }): Promise<TransferLog[]>;
}

export type Sale = { id: string; vault: string; amount: bigint; createdBlock: bigint; status: 'pendiente' | 'cobrada'; paymentId?: string };
export type Payment = { id: string; vault: string; from: string; amount: bigint; block: bigint; txHash: string; saleId?: string };

// shortcut: store en memoria, se pierde al reiniciar; cambiar por DB antes de usarlo con plata real.
export class Store {
  sales = new Map<string, Sale>();
  payments = new Map<string, Payment>();
  cursor: bigint | null = null;

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

export type PollResult = { ok: true; from: bigint; to: bigint; newPayments: number; matched: number } | { ok: false; error: unknown };

export type IndexerOpts = {
  client: ChainReader;
  store: Store;
  vaults: string[];
  token?: string;
  confirmations?: bigint;
  startBlock: bigint;
  maxRange?: bigint;
  onError?: (e: unknown) => void;
};

// Cruza un pago con la venta pendiente más vieja del mismo vault y monto exacto.
function reconcile(store: Store, p: Payment): boolean {
  if (p.saleId) return false;
  for (const s of store.sales.values()) {
    if (s.status === 'pendiente' && s.vault === p.vault && s.amount === p.amount && p.block >= s.createdBlock) {
      s.status = 'cobrada';
      s.paymentId = p.id;
      p.saleId = s.id;
      return true;
    }
  }
  return false;
}

export function createIndexer(o: IndexerOpts) {
  const token = (o.token ?? WARS).toLowerCase();
  const vaults = o.vaults.map((v) => v.toLowerCase());
  const confirmations = o.confirmations ?? 2n;
  const maxRange = o.maxRange ?? 2000n;
  const log = o.onError ?? ((e: unknown) => console.error('indexer:', e));

  // Nunca lanza: ante cualquier falla el cursor no avanza y las ventas siguen pendientes.
  async function pollOnce(): Promise<PollResult> {
    const { store, client } = o;
    try {
      const head = await client.getBlockNumber();
      const safe = head - confirmations;
      let from = store.cursor ?? o.startBlock;
      const start = from;
      let newPayments = 0;
      let matched = 0;
      while (from <= safe) {
        const to = from + maxRange - 1n < safe ? from + maxRange - 1n : safe;
        const logs = await client.getLogs({ address: token, event: transferEvent, args: { to: vaults }, fromBlock: from, toBlock: to });
        for (const l of logs) {
          const { to: dest, from: src, value } = l.args;
          if (l.address.toLowerCase() !== token || l.blockNumber == null || !l.transactionHash || l.logIndex == null) continue;
          if (!dest || !vaults.includes(dest.toLowerCase()) || typeof value !== 'bigint' || value <= 0n) continue;
          const id = `${l.transactionHash.toLowerCase()}:${l.logIndex}`;
          let p = store.payments.get(id);
          if (!p) {
            p = { id, vault: dest.toLowerCase(), from: (src ?? '').toLowerCase(), amount: value, block: l.blockNumber, txHash: l.transactionHash, };
            store.payments.set(id, p);
            newPayments++;
          }
          if (reconcile(store, p)) matched++;
        }
        store.cursor = to + 1n;
        from = to + 1n;
      }
      // Pagos viejos sin venta pueden cruzar con una venta creada después.
      for (const p of store.payments.values()) if (reconcile(store, p)) matched++;
      return { ok: true, from: start, to: safe, newPayments, matched };
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

  // Si el RPC falla no se crea la venta: sin bloque de creaci�n no se puede conciliar con seguridad.
  async function createSale(s: { id: string; vault: string; amount: bigint }): Promise<Sale> {
    return o.store.addSale({ ...s, createdBlock: await o.client.getBlockNumber() });
  }

  return { pollOnce, watch, createSale };
}
