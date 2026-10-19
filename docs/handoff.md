# Traspaso del rol de coordinador (18/10/2026, actualizado al cambio de cuenta)

> **Actualización 19/10 (coordina Claude Code):** la cuarta tanda (alta `/start`, endpoints `/sales` `/payments` `/events`, botón "Pagar con wARS") está revisada, corregida y mergeada en `Antony27c/Tildai` (`da20731`; tests: agent 61, indexer 49, web 37). Frontend nuevo en el worktree `devin-frontend` (rama `Antony27c/devin-frontend`), con tres Devin: 1) sistema visual + landing, 2) panel del comercio `/panel`, 3) pulido de la página de cobro. Usan las skills `impeccable` y `taste-skill` de `.agents/skills/`, instaladas sin hooks ni binarios. Pendientes que vio la revisión: el canal de Telegram queda abierto al `/start` (rate-limit o allowlist antes de mainnet), `cierre_caja` solo corre para el vault del dueño y un `createVault` que nunca se mina deja el chat "pendiente".

Quien lea esto toma el rol de **coordinador** de Tildai: reparte tareas a los agentes, revisa su código antes de mergear y protege las reglas de `AGENTS.md`. Antes de nada leé `AGENTS.md` e `idea.md`.

**Contexto del cambio:** coordinó Devin hasta el 18/10. El dueño cambia a la cuenta de **Claude Code**. Si el nuevo coordinador es Claude Code, `CLAUDE.md` ya importa `AGENTS.md` y fija `ponytail`: alcanza con leer esos archivos.

## Estado de las cuentas y los agentes

- **Devin: cuota DIARIA agotada** en las tres terminales de agentes (`devin-agent`, `devin-indexer`, `devin-web`). Recibieron la cuarta tanda de tareas pero no pudieron ejecutarlas. El reset es diario; la página de billing (app.devin.ai/settings/usage) muestra "weekly 1% used" porque el tope diario es un límite aparte. **No se gastó plata**: on-demand está en $0.
- **Gemini (antigravity, worktree `gemini-textile`): cuota individual agotada**, resetea ~25/10. No asignarle tareas. Su terminal quedó clavada en una encuesta del CLI.
- Los worktrees, ramas y terminales quedan como están. Cuando vuelva la cuota de Devin se puede reenviar la tarea con `orca terminal send`; si se usa Claude Code, se pueden crear terminales nuevas sobre los mismos worktrees.

## Estado real del código (rama `Antony27c/Tildai`, PR #10 abierto)

Último commit integrado: `ee0ea3f`. Tests corridos por el coordinador sobre esa integración: **agente 43, indexer 41, fx 28, web 29, contratos 22 — todos en verde** (fork test salteado salvo `FORK=1`).

| Carpeta | Qué hay | Tests |
|---|---|---|
| `contracts/` | `TildaiVault` (apartados, retiro a payout, swap Textile con permisos por bucket, tope diario en hora argentina, maxRate, opId) y `TildaiFactory` (un vault por comercio, registro `isVault`). Desplegados en **Celo Sepolia** con tokens de prueba: direcciones en `contracts/deployments/celo-sepolia.json` (factory `0x963c9f...4413`, smoke vault `0x498450...F18B`). Fork test contra mainnet real pasó una vez | `cd contracts && forge test` |
| `agent/` | `chain.ts` (clientes con attribution tag `celo_c376b2fd04bc`, fee abstraction USD₮ en mainnet), `vaultOps.ts` (apartar/retirar/dolarizar con `usedOp`, simulación y registro), `fondos.ts`, `cierreApartado.ts` (cierre 21 h AR), `tools/dolarizar.ts` (preview → cotización firme → `vault.swap`). Scripts: `deploy-sepolia.ts`, `deploy-mainnet.ts` (dry run por defecto, `CONFIRM_MAINNET=1` para ejecutar), `register-8004.ts`, `generate-wallet.ts` | `cd agent && node --test` |
| `indexer/` | Descubre vaults por `VaultCreated`, lee logs en tramos con reintentos, persiste en JSON atómico (tmp+fsync+rename), concilia por monto/bloque, x402 por tx hash. Servicio HTTP: `POST /sales`, `POST /sales/:id/tx`, `GET /sales/:id`, `GET /health`. Bearer `TILDAI_INDEXER_TOKEN`, body ≤16 KiB, comparación timing-safe | `cd indexer && node --test` |
| `web/` | Next.js: página de cobro, QR, link Ripio on-ramp. Valida el vault contra `isVault` onchain. x402 con Permit2 (solo mainnet, `@x402/core`/`@x402/evm` fijos en 2.28.0, `X402_API_KEY` solo server-side). Después del settle avisa al indexer y el cliente ve el estado del pago (poll a `GET /api/sale/[id]`) | `cd web && npm test && npm run build` |
| `fx/` | `cotizar` (preview) y `cotizarFirme` (RFQ v2 real: `data.quote`, `takerPays`, `buyAmount`, `spender`, `transactions.swap`, rechaza `no_quote`/vencidas/>1% peor que preview). `pnl.ts`: P&L de la dolarización en bigint leyendo `Swapped` onchain | `cd fx && node --test` |

**Contrato entre indexer y web** (fijado por el coordinador, ya implementado por ambos): los endpoints de arriba, montos en wei como strings, `Authorization: Bearer ${TILDAI_INDEXER_TOKEN}`, `TILDAI_INDEXER_URL` en la web.

## Tarea a medio hacer (SIN COMMIT, está en los worktrees)

- `devin-indexer`: `indexer/src/indexer.ts` ya tiene los cambios de modelo de la tarea de endpoints (Sale con `createdAt`, Payment con `timestamp` vía `getBlock`, `StoreEvent` con `seq` creciente para `GET /events`). Falta: exponer los endpoints en `server.ts`, persistir los eventos y los tests. Se puede continuar o descartar.
- `devin-web`: solo agregó `"@x402/fetch": "2.28.0"` a `web/package.json` (+ lockfile). No escribió código.
- `devin-agent`: limpio, en `ee0ea3f`.
- `gemini-textile`: en un merge viejo; ignorar su worktree.

## Tareas pendientes (cuarta tanda, textos listos para reenviar)

**Al agente (`agent/`):** alta del comercio con `/start` en Telegram. Pedir la wallet del dueño (dirección `0x…` de 42 chars, `isAddress`; nunca aceptar clave privada/seed — si llega un hex de 64, no repetirla, avisar que la borre) y el tope diario (sugerir $100.000). Crear el vault con `TildaiFactory.createVault(owner, payoutWallet = owner, dailyCap, maxRate = 1700 wARS/USD₮, maxSwap = 60000)` usando `agentClients()` (tag) y `feeCurrency` USD₮ en mainnet. Factory y red por env (en Sepolia, la de `contracts/deployments/celo-sepolia.json`). Idempotente: un chat = un vault; la dirección del vault sale del evento `VaultCreated` del recibo, no del valor simulado. Guardar chat→vault en JSON atómico. Responder con dirección del vault, link de cobro con QR fijo y resumen de límites. Si la tx falla: registrar, avisar, no dejar el chat a medias. Tests con wallet/reader falsos.

**Al indexer (`indexer/`):** endpoints para que el agente use al indexer como fuente de verdad. `GET /sales?vault=0x..&since=<ms>&until=<ms>` (ventas del rango con status y monto). `GET /payments?vault=..&since&until` (pagos confirmados con `{id, from, amount, txHash, timestamp, saleId?}`; timestamp del bloque leído una vez y guardado — si falla, el pago queda sin timestamp hasta el próximo poll, no se pierde). `GET /events?since=<cursor>` con eventos `venta_cobrada`/`pago_sin_venta` en orden y cursor `seq` persistido (el agente guarda el último procesado; sirve para avisar por Telegram sin duplicar). Mismo Bearer, strings en wei, 400 ante parámetros inválidos. Tests: filtros, pago sin venta, cursor sin repetir ni saltear, sobrevive reinicio.

**A la web (`web/`):** botón "Pagar con wARS", el lado comprador de x402 (hoy `/api/pay` no lo llama nadie). Si hay wallet inyectada (`window.ethereum`, incluye MiniPay/Valora): conectar en Celo mainnet 42220 (pedir cambio de red si está en otra) y pagar `/api/pay` con el flujo buyer de la guía x402.celo.org/skill.md (`@x402/fetch` + `@x402/evm` + viem; `@x402/fetch` 2.28.0 ya está en package.json sin commitear). Sin wallet o sin saldo: solo "Pagar con pesos" con texto simple. Después del pago, el mismo "confirmando…" con el saleId. Errores en criollo sin detalle técnico ("Rechazaste la firma", "No te alcanza el saldo", "No pudimos cobrar, no se te debitó nada"). El cliente no paga gas. Tests de la lógica sin navegador; `npm test` y `npm run build` en verde.

## Bloqueado por falta de fondeo (mainnet, NO hacer sin OK del dueño)

El dueño decidió **no comprar USD₮ por ahora** (18/10). Cuando cambie de opinión, en orden:

1. Fondear `0x2B7c25FedB6d09e149fedc1ffE35529b1cab1f65` con 2–3 USD₮ en Celo mainnet (compra en Ripio, retiro por red Celo).
2. Registrar la identidad ERC-8004 (registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`). Desde `agent/`:
   - PowerShell: `$env:CONFIRM_MAINNET="1"; node scripts/register-8004.ts celo`
   - cmd: `set "CONFIRM_MAINNET=1"` y después `node scripts/register-8004.ts celo`
   - Ojo: `set CONFIRM_MAINNET=1 && ...` en cmd guarda `"1 "` (con espacio) y en PowerShell `set` no toca el entorno: en los dos casos el script hace solo dry run.
3. Desplegar la factory (solo la factory: el primer vault sale del `/start`). Antes, `forge build --force` en `contracts/` desde un checkout limpio. Primero el dry run (`node scripts/deploy-mainnet.ts`, sin la variable) y después, desde `agent/`:
   - PowerShell: `$env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts`
   - cmd: `set "CONFIRM_MAINNET=1"` y después `node scripts/deploy-mainnet.ts`
   - Paga gas en USD₮ por fee abstraction. Guarda `factoryTx`, commit y hash del bytecode en `contracts/deployments/celo.json` apenas envía; si se corta, volver a correrlo busca el recibo en vez de redesplegar.
   - Al terminar, `Remove-Item Env:CONFIRM_MAINNET` (PowerShell) o `set "CONFIRM_MAINNET="` (cmd).
4. Falta `X402_API_KEY` del facilitador de mainnet (pedirla) y crear el proyecto en Loops (`loops project fields --event agents-on-open-rails`, `project create` sin `--confirm`, mostrarlo al dueño primero).
5. Primer swap real en Textile: chico, el corredor wARS/USD₮ tiene volumen casi nulo.

## Secretos (dónde están, nunca los valores)

- `agent/.env` (solo en el worktree `Tildai`, ignorado por git): `AGENT_PRIVATE_KEY` de la wallet `0x2B7c...1f65` y `TEXTILE_API_KEY` live aprobada.
- **La API key de Textile conviene rotarla**: se pegó una vez en `.env.example` y en el chat. Se genera una nueva en app.textilecredit.com y se borra la vieja.
- `X402_API_KEY`: todavía no existe, hay que pedirla al facilitador de Celo.
- `.env.example` siempre con valores vacíos. Nada de claves en commits ni en el chat.
- La wallet anterior `0xdc93fC0BFe839B2E80dD5c9dE4fAdE3684a72f9b` está descartada (clave expuesta): no usarla ni fondearla.

## Hackathon (Loops House)

- Entrega: **lunes 9/11/2026, 06:00 hora argentina**. Solo cuenta Celo mainnet.
- Cuenta de Loops: `antoniochocobar.sam@gmail.com`, ya inscripta. CLI `loops` instalada global. **Attribution tag: `celo_c376b2fd04bc`** (va en todas las tx, desde la primera). `withAttribution` no envuelve `deployContract`: desplegar con `sendTransaction({data: encodeDeployData(...)})` y verificar con `verifyTx`.
- ERC-8004 en Sepolia hecho: **agentId 626** (anotado en `contracts/deployments/celo-sepolia.json`). Mainnet pendiente (ver arriba).
- Las skills de Loops House están sin commit en la carpeta del Desktop (`.agents/` y `.claude/skills/loops-agents-on-open-rails`).

## Cómo se trabaja

- **Un worktree por agente**, carpeta `C:/Users/pansi/orca/workspaces/BuilderSession/<nombre>`, rama `Antony27c/<nombre>`: `devin-agent`, `devin-web`, `devin-indexer`, `gemini-textile`, y `Tildai` (coordinador). Los viejos `copepod`, `triggerfish`, `rosefish`, `hind` y `lookdown` parten del historial anterior a la reescritura: no los uses sin moverlos al `main` nuevo.
- **Crear un hilo:** `orca worktree create --name X --repo "path:C:/Users/pansi/Desktop/BuilderSession" --base-branch origin/main --setup skip`, y luego `orca terminal create --worktree "path:<carpeta>" --title X --command "<cli del agente>"`. Devin: `devin --permission-mode dangerous`. Gemini: `--agent antigravity` al crear el worktree. Para Claude Code como agente: el comando `claude` con el modo de permisos que corresponda.
- **Controlar agentes:** `orca terminal list`, `read --screen`, `show`, `send --text ... --enter`, `wait --for tui-idle`. Para orquestación supervisada usá `orca skills get orchestration`. Los handles de terminal cambian en cada sesión. Ojo: `send` puede devolver "input was accepted, but this provider cannot report delivery" — verificá con `read --screen` que el agente haya arrancado.
- **Tareas:** cada una dice objetivo, qué cambiar, límites, qué carpetas puede tocar y cómo se comprueba. Siempre: sin transacciones, sin claves, sin push, commits sin marcas.
- **Permisos de Devin:** pide aprobar descargas y comandos; la opción "Yes, switch to bypass mode" (tecla 5, luego Enter) lo deja sin pedir. Al reabrir una sesión con `-r` el modo no se hereda. Si el proceso de Devin termina, el terminal queda muerto: hay que cerrarlo y crear otro con `-r <id-de-sesión>`. Devin pide confiar en la carpeta la primera vez.
- **Reglas técnicas:** `core.hooksPath` debe ser `.githooks` en cada clon. `commit-msg` borra `Co-Authored-By` y `Generated with`. `pre-push` bloquea las ramas `devin-*` y `gemini-*` salvo `TILDAI_ALLOW_PUSH=1` (solo con autorización del dueño).
- **Ponytail no recorta nada que toque plata:** validación, manejo de errores, tests y topes siempre. En Windows el shell puede ser PowerShell: `&&` no anda, comandos de a uno; y `FORK=1` solo funciona en bash.
- **Un atajo conocido a propósito:** si el cierre aparta ahorro y falla antes de impuestos, el reintento recalcula sobre el operativo reducido y puede apartar menos de impuestos. Documentado en `cierreApartado`.
- **Otro:** `fx/pnl.ts` valúa USD₮ al ask del preview de Textile porque el corredor no tiene bid real; revisar cuando haya liquidez inversa.

## Cómo revisar el código de los agentes

Corré sus tests y probá los casos a mano; no te fíes del resumen. Fallas reales que ya aparecieron:
- Conciliar un pago con una venta anterior a él (falso "cobrada").
- Aceptar cualquier dirección de vault desde la URL.
- Interpretar "8.500" como 8,5 pesos (el punto es separador de miles en Argentina).
- Funciones simuladas que devuelven "pagado" (`payWithX402`, `simular_pago`).
- Documentos que exageran: Textile tiene cotización pero casi cero operaciones.
- Gemini entregó tests que pasaban parseando una forma de respuesta que la API real no devuelve (`data.quote`). Releé el código, no solo los tests.

Verificá direcciones de contratos con la fuente oficial; no confíes en la memoria de un agente.

## Cosas del entorno a tener en cuenta

- La carpeta del Desktop (`C:/Users/pansi/Desktop/BuilderSession`) tiene su rama `main` local en un historial viejo. Para igualarla: `git fetch origin && git reset --hard origin/main` (confirmá antes que no haya nada sin subir; los archivos de Loops House son sin commit y no se pierden).
- En el repo se reescribió el historial una vez (para sacar un `Co-Authored-By` del primer commit). Quedan ramas locales `backup-antes-reescritura-main` y `backup-antes-reescritura-tildai` con el historial viejo; se pueden borrar.
- En Windows, `.gitattributes` fuerza LF en `.githooks/*`; sin eso los hooks se rompen.
