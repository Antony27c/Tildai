# Guion del video demo (2 a 3 minutos)

Video que pide la entrega (`idea.md`, semana 3): un comercio cobrando, el aviso de la venta, el cierre de caja, el apartado de ahorro e impuestos y la dolarización, con links a Celoscan y 8004scan.

Etiquetas:
- **[SEPOLIA]**: se puede grabar ya, con el deploy de Celo Sepolia (`contracts/deployments/celo-sepolia.json`) y tokens de prueba.
- **[MAINNET]**: necesita el deploy en Celo mainnet (factory, vault, ERC-8004, `X402_API_KEY`). Hoy está pendiente.
- **[MERGE]**: depende de código que está en otra rama y todavía no está en `Antony27c/Tildai` al 19/10. Verificar antes de grabar.

Regla del guion: en off solo se dice lo que se ve funcionar en pantalla. Si una escena no se pudo grabar en mainnet, se saca. No se graba en Sepolia y se cuenta como si fuera mainnet.

## Escenas

### 1. El problema (0:00 a 0:15) [SEPOLIA]

**Pantalla:** el mostrador de un comercio de barrio (kiosco o verdulería), el cuaderno de la caja y el posnet. Si el comercio no es real, no se lo nombra como cliente.

**Off:** "Un kiosco de barrio cobra con posnet, paga comisión, espera la plata y anota la caja en un cuaderno. Y los pesos que quedan quietos pierden contra la inflación. Tildai le atiende la caja desde Telegram."

### 2. Alta del comercio con /start (0:15 a 0:35) [SEPOLIA] / [MAINNET] para la versión final

**Pantalla:** Telegram en el celular. El dueño escribe `/start`. El agente le pide su dirección `0x` y el tope diario y sugiere $100.000. El dueño pega la dirección y escribe "100.000". El agente responde con la dirección del vault, el link de cobro con QR fijo y el resumen de límites.

**Off:** "El dueño escribe /start, pasa la dirección de su wallet y elige cuánto puede mover el agente por día. Tildai le crea su propia caja onchain, un vault en Celo. La plata es del comercio, no nuestra: el agente solo la puede mover a destinos fijos y con tope diario."

**Nota:** el chat tiene que estar habilitado para el alta: hoy `TILDAI_OWNER_CHAT_ID`; con la rama `devin-agent` [MERGE], `TILDAI_ALLOWED_CHATS`. Si en vez de la dirección se pega una clave privada, el bot no la manda al modelo y pide borrarla (se puede mostrar 3 segundos, con una clave de mentira).

### 3. Un cobro con monto (0:35 a 1:05) [MAINNET]

**Pantalla:**
1. Telegram: el dueño escribe "cobrame 8.500". El agente responde con el link de pago.
2. Celular del cliente: se abre la página de cobro con el monto. El cliente toca "Pagar con wARS" desde una wallet con wARS en Celo mainnet (MiniPay, Valora o una wallet inyectada), firma y la página muestra "confirmando…" y después la venta cobrada.
3. Plano corto del botón "Pagar con pesos" (on-ramp de Ripio), sin completarlo.

**Off:** "El dueño dice cuánto cobra. El cliente escanea, firma y listo: paga en pesos onchain, en wARS de Ripio, y no paga gas porque lo cubre el facilitador x402 de Celo. Si no tiene cripto, puede pagar con pesos desde Ripio."

**Por qué [MAINNET]:** el cobro x402 solo está habilitado con `TILDAI_CHAIN_ID=42220` (`web/lib/x402.ts`), y el on-ramp de Ripio solo existe en mainnet. En Sepolia la página muestra el monto y el QR pero no cobra por x402. Para ensayar en Sepolia se puede mandar wARS de prueba directo al vault desde una wallet, pero eso no se muestra como pago x402.

### 4. El aviso de la venta (1:05 a 1:20) [SEPOLIA] con transferencia de prueba / [MAINNET] con el cobro de la escena 3

**Pantalla:** Telegram. El dueño pregunta "¿me pagaron?" y el agente responde `✓ Entraron $ 8.500 (venta #N)`.

**Off:** "La venta se tilda solo cuando el pago está confirmado en la cadena. Si no se puede verificar, queda pendiente, nunca cobrada."

**Nota:** hoy el aviso sale cuando el dueño pregunta (tool `aviso_pago`). El aviso automático de cada venta leyendo `/events` del indexer está en desarrollo [MERGE]: si está mergeado y probado al grabar, se muestra el mensaje llegando solo y el off dice "Tildai le avisa cada venta". Si no, va la pregunta.

### 5. El panel del día (1:20 a 1:35) [MAINNET] [MERGE]

**Pantalla:** `/panel?vault=<vault>` en el celular del dueño: cobrado hoy, cantidad de pagos, ventas cobradas y pendientes, saldo del vault y la lista de cobros. Tocar "ver tx" en un cobro y mostrar la tx en Celoscan.

**Off:** "Y si quiere ver la caja del día, tiene su panel. Cada cobro tiene su transacción pública en Celoscan."

**Por qué [MAINNET]:** los links "ver tx" del panel apuntan a `celoscan.io`, que es mainnet. La página `/panel` está en la rama `devin-frontend` [MERGE].

### 6. El cierre de caja (1:35 a 1:55) [SEPOLIA]

**Pantalla:** Telegram a las 21 h. Llega el mensaje del cierre:
```
Cierre de caja
Total: ...
Ventas: ...
Ticket promedio: ...
Vs. mismo día de la semana pasada (...): ...%
```

**Off:** "A las nueve de la noche Tildai cierra la caja solo: total, cantidad de ventas, ticket promedio y la comparación con el mismo día de la semana pasada."

**Nota:** para no esperar a las 21 h, se dispara el schedule a mano con `curl -X POST http://localhost:2000/eve/v1/dev/schedules/cierre_caja` (fuera de cámara). Si no hubo ventas la semana anterior, el mensaje dice "Sin ventas el mismo día de la semana pasada para comparar": se graba así, no se inventa la comparación.

### 7. El apartado de ahorro e impuestos (1:55 a 2:10) [SEPOLIA]

**Pantalla:** el mismo mensaje del cierre sigue con el bloque "Apartado": base para apartar, `ahorro: $ ... apartados`, `impuestos: $ ... apartados`. Después, la tx de `allocate` en el explorador (Celoscan en mainnet; el explorador de Celo Sepolia en el ensayo).

**Off:** "Después del cierre aparta lo que el dueño decidió para ahorro e impuestos. La plata no sale del vault: queda separada y solo el dueño la puede sacar."

**Nota:** necesita `TILDAI_SAVINGS_PCT` y `TILDAI_TAXES_PCT` configurados y ventas confirmadas ese día; si no, el mensaje dice "No aparté nada" y la escena se repite.

### 8. La dolarización en Textile FX (2:10 a 2:30) [MAINNET]

**Pantalla:** Telegram. El dueño escribe, por ejemplo, "pasá 5.000 del operativo a dólares". El agente pide la cotización a Textile, ejecuta el swap y responde con el resultado y el hash. Mostrar la tx en Celoscan con el evento `Swapped` y los USD₮ en el vault.

**Off:** "Y el excedente lo pasa a dólares en Textile FX, cuando el dueño lo pide. El contrato tiene un precio máximo del dólar y un tope por operación: si la cotización es peor, no cambia y avisa."

**Notas:**
- Hoy la dolarización corre cuando el dueño la pide (tool `dolarizar`), no sola por umbral. El off no dice "automática".
- Textile tiene cotización pero casi nada de volumen en wARS/USD₮: usar un monto chico. Si la cotización vence o supera el precio máximo, el agente rechaza: se puede grabar ese rechazo como muestra de los límites, pero no se lo presenta como un swap.
- No se puede ensayar en Sepolia: Textile solo está en mainnet. El swap se probó en un fork de mainnet (`FORK=1 forge test --match-contract Fork`).

### 9. Métricas, identidad y cierre (2:30 a 2:50) [MAINNET] [MERGE]

**Pantalla:**
1. `/metricas`: comercios, activos en 7 días, pagos confirmados, ventas cobradas, total cobrado y el gráfico de 14 días. La página está en la rama `devin-web` [MERGE].
2. 8004scan con la identidad ERC-8004 del agente en mainnet (wallet `0x2B7c25FedB6d09e149fedc1ffE35529b1cab1f65`).
3. Una tx del agente en Celoscan (el alta del vault o el apartado).
4. Placa final: "Tildai: cada cobro, tildado." y la URL del repo.

**Off:** "Todo es público: las métricas salen de la cadena, el agente tiene identidad ERC-8004 y cada transacción suya lleva el attribution tag de la hackathon. Tildai: cada cobro, tildado."

**Nota:** en `/metricas` se muestran los números que haya, aunque sean chicos. Si los pagos los hizo el equipo, no se los presenta como clientes.

### Escena opcional: retiro (si sobra tiempo, 10 s) [MAINNET]

**Pantalla:** "pasame 10.000 al banco". El agente retira a la wallet de retiro del dueño (el único destino posible) y devuelve el link de off-ramp de Ripio.

**Off:** "Cuando quiere los pesos en el banco, se los manda a su wallet y le deja el link de Ripio para retirar."

## Checklist para grabar

**Cuentas y claves** (en `.env`, nunca en cámara):
- [ ] Bot de Telegram creado con @BotFather y su `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` y `TELEGRAM_BOT_USERNAME`.
- [ ] Webhook registrado contra un túnel público al agente (`/eve/v1/telegram`, ver `agent/README.md`).
- [ ] Credenciales del modelo cargadas en eve (`/login`).
- [ ] Chat del dueño habilitado para el alta (`TILDAI_OWNER_CHAT_ID`; con [MERGE], `TILDAI_ALLOWED_CHATS`).
- [ ] `TEXTILE_API_KEY` vigente; rotarla antes si sigue siendo la que se expuso.
- [ ] [MAINNET] `X402_API_KEY` del facilitador de Celo.

**Wallets y saldo:**
- [ ] [MAINNET] Wallet del agente `0x2B7c…1f65` con USD₮ para gas (fee abstraction).
- [ ] [MAINNET] ERC-8004 registrado: `CONFIRM_MAINNET=1 node scripts/register-8004.ts celo`.
- [ ] [MAINNET] Factory desplegada: `CONFIRM_MAINNET=1 node scripts/deploy-mainnet.ts` (con el OK del dueño del proyecto).
- [ ] Wallet del dueño del comercio (dirección `0x` para el `/start`).
- [ ] [MAINNET] Wallet del cliente con wARS en Celo mainnet (MiniPay, Valora o inyectada); no necesita CELO.
- [ ] [SEPOLIA] Wallet con wARS de prueba para ensayar el aviso con una transferencia directa al vault.

**Configuración:**
- [ ] Agente: `TILDAI_NETWORK`, `TILDAI_FACTORY`, `TILDAI_FROM_BLOCK`, `TILDAI_PAY_BASE_URL` (URL pública de la web), `TILDAI_SAVINGS_PCT`, `TILDAI_TAXES_PCT`.
- [ ] Web: `TILDAI_CHAIN_ID=42220` para x402, `TILDAI_FACTORY`, `NEXT_PUBLIC_BASE_URL`, `TILDAI_INDEXER_URL`, `TILDAI_INDEXER_TOKEN`; `TILDAI_DEMO` vacío.
- [ ] Indexer corriendo con `TILDAI_STORE_PATH`, la factory y el bloque inicial de la misma red, accesible desde la web.
- [ ] Vault creado por `/start` en la red de la grabación y su dirección anotada.
- [ ] No reiniciar el agente entre el cobro y el cierre: las ventas viven en memoria (`agent/src/sales.ts`).

**URLs a tener abiertas:**
- [ ] Página de cobro: `<web>/?vault=<vault>`.
- [ ] [MERGE] Panel: `<web>/panel?vault=<vault>`.
- [ ] [MERGE] Métricas: `<web>/metricas`.
- [ ] Celoscan con las tx del vault y del agente.
- [ ] 8004scan con el agente registrado.

**Antes de publicar:**
- [ ] Revisar que no se vean claves, tokens, `.env` ni el chat id en pantalla.
- [ ] Cada número que aparece salió de la grabación, no de un mock (`TILDAI_DEMO` y el `FakeVault` apagados).
