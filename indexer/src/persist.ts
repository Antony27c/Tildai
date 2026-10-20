import { open, rename, readFile } from 'node:fs/promises';
import { Store, type Payment, type Sale, type StoreEvent } from './indexer.ts';

const str = (x: unknown, what: string) => {
  if (typeof x !== 'string') throw new Error(`${what} no es string`);
  return x;
};
const big = (x: unknown, what: string) => {
  if (typeof x !== 'string' || !/^\d+$/.test(x)) throw new Error(`${what} no es un entero en string`);
  return BigInt(x);
};
// Campo opcional: se omite la clave si no está, para que el store cargado sea igual al guardado.
const ms = (x: unknown, what: string) => {
  if (!Number.isSafeInteger(x) || (x as number) < 0) throw new Error(`${what} no es un timestamp en ms`);
  return x as number;
};
const optNum = <K extends string>(k: K, x: unknown) => (x == null ? {} : { [k]: ms(x, k) }) as { [P in K]?: number };
const opt = <K extends string>(k: K, x: unknown) => (x == null ? {} : { [k]: str(x, k) }) as { [P in K]?: string };
const bool = (x: unknown, what: string) => {
  if (typeof x !== 'boolean') throw new Error(`${what} no es boolean`);
  return x;
};
const optBool = <K extends string>(k: K, x: unknown) => (x == null ? {} : { [k]: bool(x, k) }) as { [P in K]?: boolean };
const arr = (x: unknown, what: string): unknown[] => {
  if (!Array.isArray(x)) throw new Error(`${what} no es lista`);
  return x;
};

// bigint como string: JSON no los soporta.
export function serialize(s: Store): string {
  return JSON.stringify(
    {
      version: 3,
      cursor: s.cursor?.toString() ?? null,
      vaultCursor: s.vaultCursor?.toString() ?? null,
      vaults: [...s.vaults],
      events: s.events,
      sales: [...s.sales.values()].map((v) => ({ ...v, amount: v.amount.toString(), createdBlock: v.createdBlock.toString() })),
      payments: [...s.payments.values()].map((p) => ({ ...p, amount: p.amount.toString(), block: p.block.toString() })),
    },
    null,
    2,
  );
}

export function deserialize(text: string): Store {
  const d = JSON.parse(text);
  if (d?.version !== 1 && d?.version !== 2 && d?.version !== 3) throw new Error('versión desconocida');
  const s = new Store();
  s.cursor = d.cursor == null ? null : big(d.cursor, 'cursor');
  s.vaultCursor = d.vaultCursor == null ? null : big(d.vaultCursor, 'vaultCursor');
  for (const v of arr(d.vaults, 'vaults')) {
    const [vault, owner] = arr(v, 'vault');
    s.vaults.set(str(vault, 'vault'), str(owner, 'owner'));
  }
  // Los stores v1 no tienen eventos ni timestamps: quedan vacíos/sin dato y se completan en el próximo poll.
  for (const x of arr(d.events ?? [], 'events') as Record<string, unknown>[]) {
    const type = str(x.type, 'event.type');
    if (type !== 'venta_cobrada' && type !== 'pago_sin_venta') throw new Error(`tipo de evento inválido: ${type}`);
    s.events.push({ seq: ms(x.seq, 'event.seq'), type, paymentId: str(x.paymentId, 'event.paymentId'), ...opt('saleId', x.saleId) });
  }
  for (const x of arr(d.sales, 'sales') as Record<string, unknown>[]) {
    if (x.status !== 'pendiente' && x.status !== 'cobrada') throw new Error(`estado de venta inválido: ${x.status}`);
    // En v1 el hash venía suelto en txHash; se lee como lista de un elemento.
    const txHashes = x.txHashes != null ? arr(x.txHashes, 'sale.txHashes').map((t) => str(t, 'sale.txHashes')) : x.txHash == null ? [] : [str(x.txHash, 'sale.txHash')];
    const sale: Sale = {
      id: str(x.id, 'sale.id'), vault: str(x.vault, 'sale.vault'), amount: big(x.amount, 'sale.amount'),
      createdBlock: big(x.createdBlock, 'sale.createdBlock'), createdAt: ms(x.createdAt ?? 0, 'sale.createdAt'), status: x.status,
      txHashes,
      ...opt('paymentId', x.paymentId),
    };
    s.sales.set(sale.id, sale);
  }
  for (const x of arr(d.payments, 'payments') as Record<string, unknown>[]) {
    const p: Payment = {
      id: str(x.id, 'payment.id'), vault: str(x.vault, 'payment.vault'), from: str(x.from, 'payment.from'),
      amount: big(x.amount, 'payment.amount'), block: big(x.block, 'payment.block'), txHash: str(x.txHash, 'payment.txHash'),
      ...optNum('timestamp', x.timestamp),
      ...optBool('timestampUnavailable', x.timestampUnavailable), // v3; un store viejo sin el campo reintenta y re-marca si sigue podado
      ...opt('saleId', x.saleId),
    };
    if (p.timestamp != null) delete p.timestampUnavailable; // la fecha manda: un archivo viejo puede traer las dos cosas
    s.payments.set(p.id, p);
  }
  return s;
}

// Archivo ausente = primer arranque. Archivo ilegible = error: arrancar vacío perdería ventas y repetiría cobros.
export async function loadStore(path: string): Promise<Store> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Store();
    throw e;
  }
  try {
    return deserialize(text);
  } catch (e) {
    throw new Error(`el archivo del store está corrupto (${path}): ${(e as Error).message}. Restauralo desde un backup o borralo a propósito para empezar de cero.`);
  }
}

// Escritura atómica: temporal + fsync + rename, así un corte no deja el archivo a medias.
export async function saveStore(store: Store, path: string): Promise<void> {
  const tmp = `${path}.tmp`;
  const f = await open(tmp, 'w');
  try {
    await f.writeFile(serialize(store), 'utf8');
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(tmp, path);
}

export const fileSaver = (path: string) => (store: Store) => saveStore(store, path);
