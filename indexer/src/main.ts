import { createIndexer, type ChainReader } from './indexer.ts';
import { loadConfig } from './config.ts';
import { fileSaver, loadStore, saveStore } from './persist.ts';
import { createApp } from './server.ts';
import { viemReader } from './viem-client.ts';

// Los errores nombran la variable, nunca el valor (podría ser secreto).
export async function start(env: Record<string, string | undefined> = process.env, client?: ChainReader) {
  const token = env.TILDAI_INDEXER_TOKEN;
  if (!token || token.length < 32) throw new Error('falta TILDAI_INDEXER_TOKEN (mínimo 32 caracteres)');
  const cfg = loadConfig(env);
  const storePath = cfg.storePath;
  if (!storePath) throw new Error('falta TILDAI_STORE_PATH');
  // Las variables vacías cuentan como no seteadas (||), no como valor.
  const pollSeconds = Number(env.TILDAI_POLL_SECONDS || 10);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 1) throw new Error('TILDAI_POLL_SECONDS inválido');
  const port = Number(env.TILDAI_PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('TILDAI_PORT inválido');

  const store = await loadStore(storePath);
  const indexer = createIndexer({
    client: client ?? viemReader(cfg),
    archiveClient: cfg.archiveRpcUrl ? viemReader({ network: cfg.network, rpcUrl: cfg.archiveRpcUrl }) : undefined,
    store, factory: cfg.factory, token: cfg.wars, startBlock: cfg.startBlock, save: fileSaver(storePath),
  });
  // shortcut: sin TLS ni rate limit, escucha solo en localhost por defecto; ponerlo detrás de un proxy antes de exponerlo.
  const server = createApp({ indexer, store, token, chainId: cfg.chainId });
  await new Promise<void>((ok, fail) => server.once('error', fail).listen(port, env.TILDAI_HOST || '127.0.0.1', ok));

  const ctl = new AbortController();
  const watching = indexer.watch(pollSeconds * 1000, ctl.signal);
  // Apagado prolijo e idempotente: no acepta más requests, el tramo de logs en curso termina y el store queda en disco.
  // La segunda señal devuelve la misma promesa: dos corridas concurrentes pisarían store.json.tmp.
  let stopping: Promise<void> | null = null;
  const stop = () =>
    (stopping ??= (async () => {
      const drained = new Promise<void>((ok) => server.close(() => ok()));
      ctl.abort();
      await watching;
      await drained;
      await saveStore(store, storePath);
    })());
  return { server, store, stop };
}

if (import.meta.main) {
  start().then(
    (s) => {
      console.log(`indexer escuchando en :${(s.server.address() as { port: number }).port}`);
      for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => s.stop().then(() => { console.log('indexer apagado, store guardado'); process.exit(0); }));
    },
    (e) => {
      console.error('indexer no arrancó:', e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
