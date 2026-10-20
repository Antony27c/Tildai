import type { Address } from "viem";

import { rangoDia } from "./sales.ts";
import type { Transfer, Vault } from "./vault.ts";

// The indexer's HTTP API (indexer/src/server.ts): Bearer auth, amounts as wei strings, ms timestamps.
// timestampUnavailable marks payments whose block the RPC already pruned: permanent, no date ever.
export type IndexerPayment = { id: string; from: string; amount: string; txHash: string; timestamp: number | null; timestampUnavailable?: boolean; saleId?: string };
export type IndexerEvent = {
  seq: number;
  type: "venta_cobrada" | "pago_sin_venta";
  paymentId: string;
  saleId?: string;
  payment: IndexerPayment | null;
};

export type Indexer = {
  eventosDesde(cursor: number): Promise<{ events: IndexerEvent[]; cursor: number }>;
  pagosDelVault(vault: string, range?: { since: number; until: number }): Promise<IndexerPayment[]>;
};

export type IndexerError = Error & { status?: number };

export function indexerClient(o: { baseUrl: string; token: string; fetch?: typeof fetch }): Indexer {
  const f = o.fetch ?? fetch;
  const base = o.baseUrl.replace(/\/$/, "");
  const get = async (path: string) => {
    const res = await f(`${base}${path}`, { headers: { authorization: `Bearer ${o.token}` } });
    if (!res.ok) {
      const err: IndexerError = new Error(`indexer ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  };
  return {
    eventosDesde: (cursor) => get(`/events?since=${cursor}`),
    pagosDelVault: (vault, range) => get(`/payments?vault=${vault.toLowerCase()}${range ? `&since=${range.since}&until=${range.until}` : ""}`),
  };
}

/**
 * Vault backed by the indexer instead of onchain reads: the indexer only stores confirmed payments,
 * and a payment without timestamp stays unconfirmed (it can't be placed on a day yet).
 */
export class IndexerVault implements Vault {
  address: Address;
  private indexer: Indexer;

  constructor(address: Address, indexer: Indexer) {
    this.address = address;
    this.indexer = indexer;
  }

  async transfers(): Promise<Transfer[]> {
    const pagos = await this.indexer.pagosDelVault(this.address);
    return pagos.map((p) => ({ id: p.id, from: p.from, amount: BigInt(p.amount), timestamp: p.timestamp ?? 0, confirmed: p.timestamp != null }));
  }
}

/**
 * Totals for one Argentine day via the ranged endpoint. Throws on network errors and on the indexer's 503
 * (payments still waiting for a timestamp): callers that move money treat a throw as "datos pendientes",
 * never as zero. Pruned-block payments (timestampUnavailable) don't 503: they're left out of the range and
 * callers must count them apart via the unranged endpoint.
 */
export async function ventasDelDia(indexer: Indexer, vault: string, day: number): Promise<{ total: bigint; count: number }> {
  const pagos = await indexer.pagosDelVault(vault, rangoDia(day));
  return { total: pagos.reduce((a, p) => a + BigInt(p.amount), 0n), count: pagos.length };
}
