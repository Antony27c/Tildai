import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { IndexerError, type Sale, type Store } from './indexer.ts';

export const MAX_BODY = 16 * 1024;
const UINT256 = 2n ** 256n;

type Indexer = {
  createSale(s: { id: string; vault: string; amount: bigint }): Promise<Sale>;
  markPaidByTx(saleId: string, txHash: string): Promise<Sale['status']>;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();
// Se comparan hashes del mismo largo para que el tiempo no dependa de cuánto coincide ni del largo del token.
const tokenOk = (given: string | undefined, token: string) => timingSafeEqual(digest(given ?? ''), digest(token)) && !!given;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) throw new HttpError(413, 'body demasiado grande');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body demasiado grande');
    chunks.push(c);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'el body debe ser un objeto');
  return body as Record<string, unknown>;
}

const view = (s: Sale) => ({ id: s.id, vault: s.vault, amount: s.amount.toString(), status: s.status, ...(s.txHash && { txHash: s.txHash }) });

export function createApp(o: { indexer: Indexer; store: Store; token: string; onError?: (e: unknown) => void }): Server {
  const { indexer, store } = o;
  const log = o.onError ?? ((e: unknown) => console.error('server:', e));

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let parts: string[];
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      throw new HttpError(400, 'ruta inválida');
    }
    const key = `${req.method} /${parts.map((p, i) => (i === 1 ? ':id' : p)).join('/')}`;

    if (key === 'GET /health') return send(res, 200, { cursor: store.cursor?.toString() ?? null, vaults: store.vaults.size });

    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!tokenOk(m?.[1], o.token)) return send(res, 401, { error: 'no autorizado' });

    if (key === 'POST /sales') {
      const b = await readJson(req);
      const { id, vault, amount } = b;
      if (typeof id !== 'string' || !id || id.length > 128) throw new HttpError(400, 'id inválido');
      if (typeof vault !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(vault) || !store.vaults.has(vault.toLowerCase())) throw new HttpError(400, 'vault desconocido');
      if (typeof amount !== 'string' || !/^[1-9]\d{0,77}$/.test(amount) || BigInt(amount) >= UINT256) throw new HttpError(400, 'monto inválido');
      if (store.sales.has(id)) throw new HttpError(409, 'la venta ya existe');
      const s = await indexer.createSale({ id, vault, amount: BigInt(amount) });
      return send(res, 201, { id: s.id, vault: s.vault, amount: s.amount.toString(), status: s.status, createdBlock: s.createdBlock.toString() });
    }
    if (key === 'POST /sales/:id/tx') {
      const b = await readJson(req);
      if (typeof b.txHash !== 'string') throw new HttpError(400, 'txHash inválido');
      const status = await indexer.markPaidByTx(parts[1], b.txHash);
      return send(res, 200, { id: parts[1], status });
    }
    if (key === 'GET /sales/:id') {
      const s = store.sales.get(parts[1]);
      if (!s) throw new HttpError(404, 'venta inexistente');
      return send(res, 200, view(s));
    }
    throw new HttpError(404, 'ruta inexistente');
  }

  return createServer((req, res) => {
    route(req, res).catch((e) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof IndexerError) return send(res, { not_found: 404, invalid: 400, conflict: 409 }[e.code], { error: e.message });
      log(e);
      send(res, 500, { error: 'error interno' });
    });
  });
}
