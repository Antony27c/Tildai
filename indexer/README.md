# Indexer de Tildai

Indexa `Transfer` de wARS hacia los vaults (descubiertos vía `VaultCreated` de la factory) y concilia ventas. Corre con `npm start`.

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
| `GET /health` | `{cursor, vaults}`, sin auth |

## Eventos y deduplicación

El agente guarda el último `cursor` procesado y pide `/events?since=<cursor>`: no repite ni se saltea. Un pago que entra sin venta emite `pago_sin_venta`; si después cobra una venta vía `POST /sales/:id/tx`, emite además `venta_cobrada` con el **mismo `paymentId`**. Para no avisar dos veces, el agente deduplica por `paymentId` (o por `txHash`).
