# Agente Tildai (eve + Telegram)

Agente de caja con tools `crear_cobro`, `ventas_hoy`, `aviso_pago` y un schedule de cierre de caja (21 hs ART). Con `TILDAI_VAULT` lee el vault real (`src/chainVault.ts`); sin esa variable usa el `FakeVault` en memoria y `apartar`/`retirar` quedan deshabilitadas.

## Correr en local

1. `cd agent && npm install` (Node 24+).
2. Creá un bot de prueba con @BotFather y copiá el token. Definí en tu `.env` (no se commitea):
   ```
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_WEBHOOK_SECRET_TOKEN=un-secreto-cualquiera
   TELEGRAM_BOT_USERNAME=tu_bot
   TILDAI_OWNER_CHAT_ID=<tu chat id>
   ```
   Si todavía no sabés tu chat id, dejá `TILDAI_OWNER_CHAT_ID` vacío: el bot ignora todo y loguea el id del chat que le escribió.
3. Credenciales del modelo (AI Gateway o `ANTHROPIC_API_KEY`) con `/login` en la TUI de eve.
4. `npm run dev` abre la TUI. Para Telegram exponé el puerto (ej. con un túnel) y registrá el webhook:
   ```
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -H "Content-Type: application/json" \
     -d '{"url":"https://<tu-tunel>/eve/v1/telegram","secret_token":"'"$TELEGRAM_WEBHOOK_SECRET_TOKEN"'","allowed_updates":["message","callback_query"]}'
   ```
5. Probá: "cobrame 8500", "¿me pagaron?", "¿cuánto vendí hoy?". (con el vault falso no entran pagos; eso se cubre en los tests).
6. Cierre de caja: con `npm run dev` corriendo, `curl -X POST http://localhost:2000/eve/v1/dev/schedules/cierre_caja`.

## Tests

`npm test` (`node --test`, datos falsos).

## Límites actuales

- Ventas en memoria (se pierden al reiniciar) y un solo comercio.
- Una venta es cobrada solo con un `Transfer` confirmado; si el vault falla queda pendiente. El pago se asocia a la venta pendiente más vieja con el mismo monto.
- El link de pago apunta a `TILDAI_PAY_BASE_URL` (la página de cobro todavía no existe).
- No hay push automático de "pago recibido": el aviso sale al llamar `aviso_pago`.

## Vault real (Celo)

Variables en `.env`: `TILDAI_VAULT`, `TILDAI_FROM_BLOCK` (bloque de creación del vault), `TILDAI_NETWORK` (`celo` por defecto, o `celoSepolia`) y `AGENT_PRIVATE_KEY` (solo para `apartar`/`retirar`). Las escrituras salen únicamente por `agentClients()` (con attribution tag) y llevan un `opId` = keccak256 del id de negocio; si el vault ya lo usó, devuelven `ya_ejecutada` sin enviar nada. Los tests de escritura usan clientes falsos; el de Celo Sepolia es de solo lectura (`TILDAI_SKIP_NETWORK=1` lo saltea sin red).

## Apartado en el cierre de caja

Después del resumen de las 21 hs el agente aparta ahorro e impuestos sobre lo vendido y confirmado ese día argentino (nunca más que el operativo del vault). Porcentajes por `.env`: `TILDAI_SAVINGS_PCT` y `TILDAI_TAXES_PCT` (0 a 100, suma <= 100); si faltan o son inválidos no aparta y lo dice en el mensaje. Los ids `cierre:<fecha AR>:ahorro|impuestos` evitan apartar dos veces si el cierre se repite. En mainnet el gas se paga en USD₮ (`feeCurrency` con el adapter oficial).

## Dolarizar

La tool `dolarizar` (operativo, ahorro o impuestos) pide un preview a Textile, después una cotización firme (`fx/cotizarFirme`, requiere `TEXTILE_API_KEY` y `npm install` dentro de `fx/`) y llama a `vault.swap`. No envía si la cotización supera el precio máximo del vault (propone subirlo: lo firma el dueño), si el dueño no habilitó dolarizar ahorro/impuestos, si el vault está pausado o si la cotización vence antes de mandar la tx. Los tests usan fakes: no se llama a Textile.

## Alta del comercio (/start)

Las tools resuelven el vault del CHAT REAL de la sesión (el chat_id que pone el auth de Telegram, no un parámetro del modelo): un chat sin vault propio solo puede hacer el alta y nunca cae al vault de env, que es solo del chat de TILDAI_OWNER_CHAT_ID. Si un mensaje parece una clave privada o frase semilla no llega al modelo: el canal contesta que la borre. El agente pide la wallet del dueño (0x) y el tope diario en texto ("100.000" = cien mil), y crear_vault llama a TildaiFactory.createVault (attribution tag, feeCurrency USD₮ en mainnet). Un chat = un vault (registro JSON atómico en TILDAI_REGISTRY, default data/chats.json), con lock por chat contra /start simultáneos; la dirección sale del evento VaultCreated del recibo y, si una tx anterior quedó sin confirmar, antes de reintentar espera su recibo (pendiente = no manda otra) o barre los logs de la factory por el owner guardado. Variables: TILDAI_FACTORY y TILDAI_FROM_BLOCK (en Sepolia, la factory de contracts/deployments/celo-sepolia.json).
