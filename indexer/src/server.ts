import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { IndexerError, type Payment, type Sale, type Store } from './indexer.ts';

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

const pview = (p: Payment) => ({ id: p.id, from: p.from, amount: p.amount.toString(), txHash: p.txHash, timestamp: p.timestamp ?? null, ...(p.saleId && { saleId: p.saleId }) });

// txHash queda por compatibilidad como el último informado; la lista completa es txHashes.
const view = (s: Sale) => ({ id: s.id, vault: s.vault, amount: s.amount.toString(), status: s.status, txHashes: s.txHashes, ...(s.txHashes.length && { txHash: s.txHashes.at(-1) }) });

const intParam = (url: URL, name: string, def: number) => {
  const v = url.searchParams.get(name);
  if (v == null) return def;
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n)) throw new HttpError(400, `${name} inválido`);
  return n;
};

const vaultParam = (url: URL) => {
  const v = url.searchParams.get('vault');
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new HttpError(400, 'vault inválido');
  return v.toLowerCase();
};

// [since, until) en ms; invertidos o no numéricos es 400.
const range = (url: URL): [number, number] => {
  const since = intParam(url, 'since', 0);
  const until = url.searchParams.get('until') == null ? Infinity : intParam(url, 'until', 0);
  if (since > until) throw new HttpError(400, 'since mayor que until');
  return [since, until];
};

const DAY = 86_400_000;
const AR = -3 * 3_600_000; // hora argentina: UTC-3 fijo, sin cambio de hora
const arDay = (ms: number) => new Date(ms + AR).toISOString().slice(0, 10);

// Métricas para la entrega. Un pago sin timestamp cuenta en los totales pero no en
// byDay ni en activeVaults7d: ubicarlo en un día sería inventar la fecha.
export function stats(store: Store, chainId: number, now = Date.now()) {
  const days = new Map<string, { payments: number; warsReceived: bigint }>();
  for (let i = 13; i >= 0; i--) days.set(arDay(now - i * DAY), { payments: 0, warsReceived: 0n });
  const active = new Set<string>();
  let warsReceived = 0n;
  let paymentsWithoutTimestamp = 0;
  for (const p of store.payments.values()) {
    warsReceived += p.amount;
    if (p.timestamp == null) {
      paymentsWithoutTimestamp++;
      continue;
    }
    if (arDay(p.timestamp) >= arDay(now - 6 * DAY)) active.add(p.vault); // 7 días calendario AR, como byDay
    const d = days.get(arDay(p.timestamp));
    if (d) {
      d.payments++;
      d.warsReceived += p.amount;
    }
  }
  let salesCobradas = 0;
  for (const s of store.sales.values()) if (s.status === 'cobrada') salesCobradas++;
  return {
    chainId,
    vaults: store.vaults.size,
    activeVaults7d: active.size,
    payments: store.payments.size,
    salesCobradas,
    warsReceived: warsReceived.toString(),
    paymentsWithoutTimestamp,
    byDay: [...days].map(([day, d]) => ({ day, payments: d.payments, warsReceived: d.warsReceived.toString() })),
    generatedAt: new Date(now).toISOString(),
  };
}

export function createApp(o: { indexer: Indexer; store: Store; token: string; chainId: number; onError?: (e: unknown) => void }): Server {
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
    if (key === 'GET /sales') {
      const vault = vaultParam(url);
      const [since, until] = range(url);
      const list = [...store.sales.values()].filter((x) => x.vault === vault && x.createdAt >= since && x.createdAt < until);
      return send(res, 200, list.map((x) => ({ ...view(x), createdAt: x.createdAt })));
    }
    if (key === 'GET /payments') {
      const vault = vaultParam(url);
      const [since, until] = range(url);
      const list = [...store.payments.values()].filter((p) => p.vault === vault);
      // Con rango y pagos sin timestamp la respuesta no es confiable: 503 para reintentar. Sin rango, se incluyen con timestamp null.
      if ((url.searchParams.has('since') || url.searchParams.has('until')) && list.some((p) => p.timestamp == null)) {
        throw new HttpError(503, 'hay pagos sin timestamp todavía, reintenta');
      }
      return send(res, 200, list.filter((p) => p.timestamp == null || (p.timestamp >= since && p.timestamp < until)).sort((a, b) => Number(a.block - b.block)).map(pview));
    }
    if (key === 'GET /events') {
      const since = intParam(url, 'since', 0);
      const last = store.events.at(-1)?.seq ?? 0;
      if (since > last) throw new HttpError(400, 'cursor mayor que el último evento');
      const list = store.events.filter((e) => e.seq > since).slice(0, 500).map((e) => ({ ...e, payment: store.payments.get(e.paymentId) ? pview(store.payments.get(e.paymentId)!) : null }));
      // El cursor es el seq del último evento devuelto: con más de 500, el agente sigue desde ahí y no se saltea.
      return send(res, 200, { events: list, cursor: list.at(-1)?.seq ?? since });
    }
    if (key === 'GET /stats') return send(res, 200, stats(store, o.chainId));
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
