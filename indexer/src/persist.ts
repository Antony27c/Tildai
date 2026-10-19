import { open, rename, readFile } from 'node:fs/promises';
import { Store, type Payment, type Sale } from './indexer.ts';

const str = (x: unknown, what: string) => {
  if (typeof x !== 'string') throw new Error(`${what} no es string`);
  return x;
};
const big = (x: unknown, what: string) => {
  if (typeof x !== 'string' || !/^\d+$/.test(x)) throw new Error(`${what} no es un entero en string`);
  return BigInt(x);
};
// Campo opcional: se omite la clave si no está, para que el store cargado sea igual al guardado.
const opt = <K extends string>(k: K, x: unknown) => (x == null ? {} : { [k]: str(x, k) }) as { [P in K]?: string };
const arr = (x: unknown, what: string): unknown[] => {
  if (!Array.isArray(x)) throw new Error(`${what} no es lista`);
  return x;
};

// bigint como string: JSON no los soporta.
export function serialize(s: Store): string {
  return JSON.stringify(
    {
      version: 1,
      cursor: s.cursor?.toString() ?? null,
      vaultCursor: s.vaultCursor?.toString() ?? null,
      vaults: [...s.vaults],
      sales: [...s.sales.values()].map((v) => ({ ...v, amount: v.amount.toString(), createdBlock: v.createdBlock.toString() })),
      payments: [...s.payments.values()].map((p) => ({ ...p, amount: p.amount.toString(), block: p.block.toString() })),
    },
    null,
    2,
  );
}

export function deserialize(text: string): Store {
  const d = JSON.parse(text);
  if (d?.version !== 1) throw new Error('versión desconocida');
  const s = new Store();
  s.cursor = d.cursor == null ? null : big(d.cursor, 'cursor');
  s.vaultCursor = d.vaultCursor == null ? null : big(d.vaultCursor, 'vaultCursor');
  for (const v of arr(d.vaults, 'vaults')) {
    const [vault, owner] = arr(v, 'vault');
    s.vaults.set(str(vault, 'vault'), str(owner, 'owner'));
  }
  for (const x of arr(d.sales, 'sales') as Record<string, unknown>[]) {
    if (x.status !== 'pendiente' && x.status !== 'cobrada') throw new Error(`estado de venta inválido: ${x.status}`);
    const sale: Sale = {
      id: str(x.id, 'sale.id'), vault: str(x.vault, 'sale.vault'), amount: big(x.amount, 'sale.amount'),
      createdBlock: big(x.createdBlock, 'sale.createdBlock'), status: x.status,
      ...opt('paymentId', x.paymentId), ...opt('txHash', x.txHash),
    };
    s.sales.set(sale.id, sale);
  }
  for (const x of arr(d.payments, 'payments') as Record<string, unknown>[]) {
    const p: Payment = {
      id: str(x.id, 'payment.id'), vault: str(x.vault, 'payment.vault'), from: str(x.from, 'payment.from'),
      amount: big(x.amount, 'payment.amount'), block: big(x.block, 'payment.block'), txHash: str(x.txHash, 'payment.txHash'),
      ...opt('saleId', x.saleId),
    };
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
