# Indexer de Tildai

Indexa `Transfer` de wARS hacia los vaults (descubiertos vía `VaultCreated` de la factory) y concilia ventas. Corre con `npm start`; tests con `npm test` (`TILDAI_OFFLINE=1` saltea el test contra Sepolia).

Variables: `TILDAI_INDEXER_TOKEN` (mín. 16 caracteres) y `TILDAI_STORE_PATH` (JSON donde persiste el estado) obligatorias; `TILDAI_NETWORK` (`celo` por defecto o `celo-sepolia`); en mainnet además `TILDAI_FACTORY` y `TILDAI_FROM_BLOCK` (en Sepolia salen de `contracts/deployments/celo-sepolia.json`). Opcionales: `TILDAI_WARS`, `RPC_URL`, `TILDAI_POLL_SECONDS` (10), `TILDAI_PORT` (8787), `TILDAI_HOST` (127.0.0.1).

## Correr en un server

```
cd indexer && npm start
```

Variables (si falta o es inválida alguna obligatoria, el proceso falla al inicio nombrando la variable):

| Variable | Descripción |
|---|---|
| `TILDAI_INDEXER_TOKEN` | **Obligatoria**, mínimo 32 caracteres. Bearer de todas las rutas salvo `/health`. |
| `TILDAI_STORE_PATH` | **Obligatoria**. Ruta del JSON donde persiste el store (ventas, pagos, cursores). |
| `TILDAI_NETWORK` | `celo` (default) o `celo-sepolia`. |
| `TILDAI_FACTORY` | Dirección de la factory. Obligatoria en mainnet; en Sepolia sale de `contracts/deployments/celo-sepolia.json`. |
| `TILDAI_FROM_BLOCK` | Bloque de deploy de la factory. Obligatorio en mainnet. |
| `RPC_URL` | Default: Forno de la red. |
| `TILDAI_WARS` | Default: wARS de la red. |
| `TILDAI_PORT` / `TILDAI_HOST` | Default `8787` / `127.0.0.1`. |
| `TILDAI_POLL_SECONDS` | Segundos entre polls, entero. Default `10`. |

El store queda en `TILDAI_STORE_PATH`: se guarda tras cada cambio y al apagar con SIGINT/SIGTERM (apagado prolijo: no acepta más requests, termina el tramo de logs en curso y persiste). Healthcheck sin auth: `GET /health` → `{cursor, vaults}`.

## API

Toda ruta exige `Authorization: Bearer <TILDAI_INDEXER_TOKEN>` salvo `GET /health`. Montos en wei como strings; `timestamp` y `createdAt` en milisegundos; rangos `[since, until)`.

| Ruta | Descripción |
|---|---|
| `POST /sales` `{id, vault, amount}` | Crea la venta (201; 409 duplicada; 400 vault desconocido o monto inválido) |
| `POST /sales/:id/tx` `{txHash}` | Ata la venta a una tx x402; cobra solo si el `Transfer` confirmado coincide (200; 404; 409) |
| `GET /sales/:id` | Una venta (200; 404) |
| `GET /sales?vault=&since=&until=` | Ventas del vault en el rango de creación |
| `GET /payments?vault=&since=&until=` | Pagos confirmados al vault; con rango, 503 si falta algún timestamp; sin rango, vienen con `timestamp: null` |
| `GET /events?since=` | Eventos `{seq, type, paymentId, saleId?, payment}` de a 500; `cursor` es el `seq` del último devuelto |
| `GET /stats` | Métricas para la entrega: `{vaults, activeVaults7d, payments, salesCobradas, warsReceived, paymentsWithoutTimestamp, byDay[14] en hora AR, generatedAt}` |
| `GET /health` | `{cursor, vaults}`, sin auth |

## Eventos y deduplicación

El agente guarda el último `cursor` procesado y pide `/events?since=<cursor>`: no repite ni se saltea. Un pago que entra sin venta emite `pago_sin_venta`; si después cobra una venta vía `POST /sales/:id/tx`, emite además `venta_cobrada` con el **mismo `paymentId`**. Para no avisar dos veces, el agente deduplica por `paymentId` (o por `txHash`).
