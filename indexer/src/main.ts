import { createIndexer } from './indexer.ts';
import { loadConfig } from './config.ts';
import { fileSaver, loadStore } from './persist.ts';
import { createApp } from './server.ts';
import { viemReader } from './viem-client.ts';

export async function start(env: Record<string, string | undefined> = process.env) {
  const token = env.TILDAI_INDEXER_TOKEN;
  if (!token || token.length < 16) throw new Error('falta TILDAI_INDEXER_TOKEN (mínimo 16 caracteres)');
  const cfg = loadConfig(env);
  if (!cfg.storePath) throw new Error('falta TILDAI_STORE_PATH');
  const pollSeconds = Number(env.TILDAI_POLL_SECONDS ?? 10);
  if (!(pollSeconds > 0)) throw new Error('TILDAI_POLL_SECONDS inválido');

  const store = await loadStore(cfg.storePath);
  const indexer = createIndexer({ client: viemReader(cfg), store, factory: cfg.factory, token: cfg.wars, startBlock: cfg.startBlock, save: fileSaver(cfg.storePath) });
  // shortcut: sin TLS ni rate limit, escucha solo en localhost por defecto; ponerlo detrás de un proxy antes de exponerlo.
  const server = createApp({ indexer, store, token });
  await new Promise<void>((ok, fail) => server.once('error', fail).listen(Number(env.TILDAI_PORT ?? 8787), env.TILDAI_HOST ?? '127.0.0.1', ok));

  const ctl = new AbortController();
  const watching = indexer.watch(pollSeconds * 1000, ctl.signal);
  const stop = async () => {
    ctl.abort();
    server.close();
    await watching;
  };
  return { server, store, stop };
}

if (import.meta.main) {
  start().then(
    (s) => {
      console.log(`indexer escuchando en :${(s.server.address() as { port: number }).port}`);
      for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => s.stop().then(() => process.exit(0)));
    },
    (e) => {
      console.error('indexer no arrancó:', e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
