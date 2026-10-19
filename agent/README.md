# Agente Tildai (eve + Telegram)

Agente de caja con tools `crear_cobro`, `ventas_hoy`, `aviso_pago` y un schedule de cierre de caja (21 hs ART). El vault es una versión falsa en memoria (`src/vault.ts`): no se envía ninguna tx ni se usan claves.

## Correr en local

1. `cd agent && npm install` (Node 24+).
2. Creá un bot de prueba con @BotFather y copiá el token. Definí en tu `.env` (no se commitea):
   ```
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_WEBHOOK_SECRET_TOKEN=un-secreto-cualquiera
   TELEGRAM_BOT_USERNAME=tu_bot
   TILDAI_OWNER_CHAT_ID=<tu chat id>
   TILDAI_DEMO=1            # habilita simular_pago (solo demo)
   ```
   Si todavía no sabés tu chat id, dejá `TILDAI_OWNER_CHAT_ID` vacío: el bot ignora todo y loguea el id del chat que le escribió.
3. Credenciales del modelo (AI Gateway o `ANTHROPIC_API_KEY`) con `/login` en la TUI de eve.
4. `npm run dev` abre la TUI. Para Telegram exponé el puerto (ej. con un túnel) y registrá el webhook:
   ```
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -H "Content-Type: application/json" \
     -d '{"url":"https://<tu-tunel>/eve/v1/telegram","secret_token":"'"$TELEGRAM_WEBHOOK_SECRET_TOKEN"'","allowed_updates":["message","callback_query"]}'
   ```
5. Probá: "cobrame 8500", "simulá un pago de 8500", "¿me pagaron?", "¿cuánto vendí hoy?".
6. Cierre de caja: con `npm run dev` corriendo, `curl -X POST http://localhost:2000/eve/v1/dev/schedules/cierre_caja`.

## Tests

`npm test` (`node --test`, datos falsos).

## Límites actuales

- Ventas en memoria (se pierden al reiniciar) y un solo comercio.
- Una venta es cobrada solo con un `Transfer` confirmado; si el vault falla queda pendiente. El pago se asocia a la venta pendiente más vieja con el mismo monto.
- El link de pago apunta a `TILDAI_PAY_BASE_URL` (la página de cobro todavía no existe).
- No hay push automático de "pago recibido": el aviso sale al llamar `aviso_pago`.
