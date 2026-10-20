# Runbook: deploy a Celo mainnet

Paso a paso para el día del deploy. Todo lo que hay acá está verificado contra el código del repo; cada comando se corre desde la raíz salvo que diga otra cosa. Los comandos son para PowerShell (la máquina del dueño es Windows); donde la sintaxis cambia va la versión de cmd/bash abajo.

**Antes de empezar:** nada de esto corre sin el OK del dueño. Ninguna clave va en la terminal a la vista, en el chat ni en un commit: todo por `agent/.env`, que está en `.gitignore`.

## 1. Requisitos previos

- [ ] **Wallet del agente fondeada:** `0x2B7c25FedB6d09e149fedc1ffE35529b1cab1f65` (la misma de Sepolia, anotada en `README.md`) con **2–3 USD₮ en Celo mainnet**. wARS no paga gas: el agente paga en USD₮ por *fee abstraction* con el adapter oficial `0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72` (docs.celo.org/build-on-celo/fee-abstraction; es el `feeCurrency` de `agent/src/runtime.ts` y `agent/scripts/deploy-mainnet.ts`). Cómo fondearla: comprar USD₮ en Ripio y retirar por red Celo (`docs/handoff.md`). La wallet vieja `0xdc93fC0BFe839B2E80dD5c9dE4fAdE3684a72f9b` está descartada (clave expuesta): no fondearla ni usarla.
- [ ] **`AGENT_PRIVATE_KEY`** de esa wallet en `agent/.env` (copiar `agent/.env.example`). Chequeo rápido de que es la clave correcta: cualquier dry run del paso 2 muestra `Agente 0x2B7c…` en la salida.
- [ ] **`X402_API_KEY`** del facilitador `https://api.x402.celo.org` (se pide al equipo de x402; va en `web/.env`, solo server-side).
- [ ] **`TEXTILE_API_KEY` rotada:** la live vieja se expuso una vez en el chat (ver `docs/handoff.md`, "Secretos"). Generar una nueva en app.textilecredit.com y borrar la vieja. Va en `agent/.env`.
- [ ] **`TILDAI_MAX_RATE` del día:** pesos por USD₮ que acepta pagar un vault nuevo al dolarizar. Es **obligatoria en mainnet, sin default**: sin ella el alta no anda (`agent/src/alta.ts` tira "Falta TILDAI_MAX_RATE"). Se fija como la cotización del día de Textile (preview en api.textilecredit.com, ver `docs/textile-fx.md`) **más un 2–3 %** de margen. Formato: número en pesos, ej. `1.700` (= 1.700 ARS por USD₮). El código la rechaza si pasa de 50.000.
- [ ] **Bot de Telegram:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `TELEGRAM_BOT_USERNAME` en `agent/.env` (creado con @BotFather), y el webhook registrado contra la URL pública del agente (comando en `agent/README.md`). El dueño anota su `TILDAI_OWNER_CHAT_ID`.
- [ ] **Credenciales del modelo** cargadas en eve (`/login`, AI Gateway o `ANTHROPIC_API_KEY`).
- [ ] **Node 24+**, **npm install** hecho en `agent/`, `indexer/`, `web/` y `fx/`, y **forge** instalado.
- [ ] **Checkout limpio:** `git status` sin cambios en `contracts/src` (el deploy frena si está sucio).

## 2. Deploy de la factory

Solo se despliega `TildaiFactory`: los vaults los crea después el `/start` de cada comercio.

```powershell
cd contracts
forge build --force

cd ..\agent
node scripts/deploy-mainnet.ts    # DRY RUN: simula, no manda nada
```

El dry run tiene que saludar así:

```
Simulación OK. Agente 0x2B7c25FedB6d09e149fedc1ffE35529b1cab1f65, saldo USD₮ para gas: 3. Commit <sha>, bytecode 0x<hash>
Dry run: no se mandó nada. Para desplegar: $env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts
```

Si el saldo dice `0`, no seguir: el deploy real frena con "el agente no tiene USD₮ para pagar el gas".

Deploy real:

```powershell
$env:CONFIRM_MAINNET="1"; node scripts/deploy-mainnet.ts
# cmd:    set "CONFIRM_MAINNET=1"  y después  node scripts/deploy-mainnet.ts
# Ojo: en cmd NO usar `set CONFIRM_MAINNET=1 && ...` (queda "1 " con espacio y hace dry run).
```

Al confirmar, `contracts/deployments/celo.json` queda así (campos que el script fue guardando):

| Campo | Cuándo se guarda |
|---|---|
| `deployNonce` + `expectedFactory` + `commit` + `bytecodeHash` | **antes** de enviar la tx (por eso un corte no duplica el deploy) |
| `factoryTx` | apenas vuelve `sendTransaction` |
| `factory` + `factoryBlock` | cuando el recibo confirma con tag, `contractAddress` y `wars`/`usdt`/`agent` verificados |

La tx va con el attribution tag `celo_c376b2fd04bc` y el script lo verifica con `verifyTx` antes de registrar la factory: si la tx no lo lleva, frena ("no doy por buena una factory sin tag").

**Si se corta a la mitad** (timeout de RPC, se cierra la terminal): **volver a correr el mismo comando, nada más**. El script decide solo:

| Mensaje que vas a ver | Qué pasó | Qué hace |
|---|---|---|
| `Hay un contrato en la dirección esperada 0x…: lo recupero, no redespliego.` | La tx minó pero no se registró | Verifica el bytecode y la tx que la creó, y registra |
| `El deploy 0x… todavía no está en cadena: espero su recibo, no reenvío.` | `factoryTx` guardado sin confirmar | Espera el recibo |
| `… no está en cadena y el nonce sigue libre: lo reenvío con el MISMO nonce.` | La tx se perdió sin llegar a mempool | Reenvía con el nonce reservado (nunca puede minar dos veces) |
| `el nonce N ya se usó pero no hay contrato en 0x…: revisar a mano.` | El nonce se gastó en otra tx | Frena: revisar en Celoscan antes de tocar nada |
| `No apareció el recibo de 0x… Si la tx no existe en el explorador, borrá factoryTx de celo.json y volvé a correr` | El recibo no llega (descarte o RPC malo) | Esperar/revisar Celoscan; borrar `factoryTx` solo si la tx no existe |
| `no pude localizar la tx que creó 0x… : Completá factoryTx a mano en celo.json` | El RPC no sirve estado histórico | Copiar el hash de la tx de Celoscan a `factoryTx` y re-correr |

**No tocar a mano** `deployNonce` ni `expectedFactory`, y no borrar `celo.json` entero: es la única memoria del deploy.

Terminado el deploy:

```powershell
Remove-Item Env:CONFIRM_MAINNET     # cmd: set "CONFIRM_MAINNET="
```

Anotar: `factory` y `factoryBlock` de `celo.json` — el bloque es el `TILDAI_FROM_BLOCK` de todos los servicios.

## 3. Verificación de los contratos en el explorador

**[PENDIENTE]** — el repo todavía no tiene un comando de verificación (no hay `forge verify` configurado ni API key de Celoscan en el proyecto). El día del deploy:

1. Subir el source de `TildaiFactory` a Celoscan con la verificación estándar de forge (`forge verify-contract`, requiere API key de Celoscan) o por Sourcify.
2. Cuando el primer `/start` cree un vault, verificar `TildaiVault` igual (los vaults salen todos del mismo bytecode).

No bloquea el cobro ni la entrega, pero conviene hacerlo el mismo día para que el panel de métricas y las demos apunten a código verificado.

## 4. Identidad ERC-8004

Desde `agent/` (con la wallet ya fondeada):

```powershell
node scripts/register-8004.ts celo              # dry run: dice lo que haría
$env:CONFIRM_MAINNET="1"; node scripts/register-8004.ts celo
```

- Manda `register` y después `setAgentURI` (con `registrations`), las dos con tag y verificadas. Si ya hay identidad, no hace nada o completa la URI si quedó a medias: es seguro re-correrlo.
- Registry mainnet: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (es el que usa el script).
- **El `agentId` queda escrito solo** en `contracts/deployments/celo.json` (campo `agentId`). Anotarlo también para la entrega y mirarlo en 8004scan.
- Se puede correr antes o después del paso 2: no depende de la factory.

## 5. Variables de cada servicio

Valores sacados de los `.env.example` y del código. **Obligatorias** = el servicio no arranca o la función clave no anda sin ellas. `TILDAI_FROM_BLOCK` es siempre el `factoryBlock` de `contracts/deployments/celo.json` (con la recién desplegada; después cada vault nuevo trae su propio bloque en el registro).

### Agente (`agent/.env`)

| Variable | Oblig. | Para qué |
|---|---|---|
| `AGENT_PRIVATE_KEY` | sí (escrituras) | Clave de `0x2B7c…1f65`. Sin ella, `apartar`/`retirar`/`dolarizar`/altas no firman. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET_TOKEN` / `TELEGRAM_BOT_USERNAME` | sí | Las lee eve para el canal (ver `agent/README.md`). |
| `TILDAI_OWNER_CHAT_ID` | sí | Chat del dueño: el único que usa el `TILDAI_VAULT` de env y siempre habilitado. |
| `TILDAI_FACTORY` | sí | Factory de mainnet (`factory` de `celo.json`). Sin ella el `/start` dice "no puedo dar de alta". |
| `TILDAI_FROM_BLOCK` | sí | Bloque de deploy de la factory (`factoryBlock`): base de los barridos de `VaultCreated`. |
| `TILDAI_MAX_RATE` | **sí en mainnet** | Pesos por USD₮ del paso 1. Sin ella el alta falla; fuera de rango (> 50.000) también. |
| `TILDAI_PAY_BASE_URL` | sí | URL pública de la web; arma los links `/?vault=…&amount=…` que manda el agente. |
| `TILDAI_INDEXER_URL` / `TILDAI_INDEXER_TOKEN` | sí (avisos) | Sin indexer no hay avisos de venta automáticos ni el indexer como fuente de verdad. |
| `TILDAI_NETWORK` | no | `celo` por default. **No setearla** en mainnet (`celoSepolia` es solo pruebas). |
| `TILDAI_ALLOWED_CHATS` | no | Chat ids habilitados para el alta, por coma. Vacío = solo los ya registrados y el dueño. |
| `TILDAI_SAVINGS_PCT` / `TILDAI_TAXES_PCT` | no | % que aparta el cierre (0–100, suma ≤ 100). Sin ellas el cierre no aparta y lo avisa. |
| `TILDAI_MAX_ALTAS_DIA` / `TILDAI_ALTA_PENDIENTE_MIN` | no | Defaults 5 altas/día y 30 min. Un valor inválido cierra las altas a 0. |
| `TILDAI_REGISTRY` / `TILDAI_OPS_FILE` / `TILDAI_EVENTS_FILE` | no | Defaults `data/chats.json`, `data/ops.jsonl`, `data/eventos.json`. |
| `TILDAI_VAULT` | no | Solo el vault del dueño si ya existe fuera del registro. Los comercios van por `/start`, no por env. |
| `TEXTILE_API_KEY` | no | Solo la tool `dolarizar` (y `npm install` dentro de `fx/`). Sin ella `dolarizar` avisa que falta. |
| `TILDAI_OPEN_SIGNUP` | **no — ver §9** | No setearla. |
| `TILDAI_DEMO` | nunca | No existe en el agente; la de la web tampoco va en mainnet. |

### Indexer

| Variable | Oblig. | Para qué |
|---|---|---|
| `TILDAI_INDEXER_TOKEN` | sí | Bearer de todas las rutas salvo `/health`; **mínimo 32 caracteres**. El mismo valor va en `TILDAI_INDEXER_TOKEN` del agente y de la web. |
| `TILDAI_STORE_PATH` | sí | JSON donde persiste ventas, pagos y cursor. |
| `TILDAI_FACTORY` | sí (mainnet) | `factory` de `celo.json`. |
| `TILDAI_FROM_BLOCK` | sí (mainnet) | `factoryBlock` de `celo.json`. |
| `TILDAI_NETWORK` | no | `celo` es el default: no hace falta setearla. |
| `TILDAI_ARCHIVE_RPC_URL` | recomendada | Nodo de archivo para las fechas de pagos en bloques que Forno ya podó (> ~10.000 bloques). Sin él esos pagos quedan `timestampUnavailable` y no entran en los totales por día. |
| `RPC_URL` | no | Default `https://forno.celo.org`. |
| `TILDAI_WARS` | no | Default: wARS de mainnet. |
| `TILDAI_PORT` / `TILDAI_HOST` / `TILDAI_POLL_SECONDS` | no | Defaults `8787` / `127.0.0.1` / `10`. |
| `TILDAI_HOST` | no | Si se expone fuera de localhost, **tiene que ir detrás de un proxy con https**: el Bearer viaja en cada request (la web además rechaza `TILDAI_INDEXER_URL` http fuera de localhost). |

### Web (`web/.env`)

| Variable | Oblig. | Para qué |
|---|---|---|
| `TILDAI_CHAIN_ID` | sí | `42220`. Con otro valor x402 no cobra ("x402 solo cobra en Celo mainnet"). |
| `TILDAI_FACTORY` | sí | Valida cada vault con `isVault` onchain antes de mostrar la página de cobro. |
| `X402_API_KEY` | sí | Del facilitador `api.x402.celo.org`. Solo server-side. |
| `TILDAI_INDEXER_URL` / `TILDAI_INDEXER_TOKEN` | sí | Después del settle avisa al indexer y el cliente ve el estado por `/api/sale/[id]`. |
| `NEXT_PUBLIC_BASE_URL` | sí | URL pública de la página (QR fijo del cartel). |
| `NEXT_PUBLIC_TELEGRAM_BOT_URL` | no | `https://t.me/<bot>`; sin ella la landing no muestra el botón "Empezá por Telegram". |
| `TILDAI_RPC_URL` | no | Default: el RPC público de la red. |
| `TILDAI_DEMO` | **dejar vacía** | En 42220 el código ya la ignora, pero no se setea igual (ver §9). |

## 6. Orden de arranque

**indexer → web → agente.** Cada uno con su chequeo antes de levantar el siguiente.

**1. Indexer** (con las variables de su tabla cargadas):

```powershell
cd indexer
npm start        # "indexer escuchando en :8787"
curl http://127.0.0.1:8787/health   # -> {"cursor":null,"vaults":0}  (sin auth; los números suben cuando indexa)
```

Si se expone para que la web y el agente lo alcancen: detrás del proxy https, `TILDAI_HOST` según corresponda, y `TILDAI_INDEXER_URL` con la URL https pública en los otros dos servicios.

**2. Web:**

```powershell
cd web
npm run build
npm start        # Next.js en :3000
```

Chequeo: abrir `http://localhost:3000/` — la landing carga. Con el vault del paso 7, `/?vault=0x…&amount=100` muestra la página de cobro (antes del primer vault valida contra la factory ya desplegada).

**3. Agente:**

```powershell
cd agent
npm run dev      # TUI de eve
```

Webhook registrado (paso 1) apuntando a `https://<url-pública>/eve/v1/telegram`. Chequeo: desde el chat del dueño (`TILDAI_OWNER_CHAT_ID`), mandar `/start` al bot. Contesta el flujo de alta (pide la wallet `0x` del dueño del comercio y el tope diario). Un chat ajeno recibe "el alta es por invitación" si `TILDAI_ALLOWED_CHATS` está vacío — eso es lo esperado.

## 7. Primer cobro real

Monto chico (unos $100) para no arriesgar nada:

1. El dueño hace `/start` → el agente crea el vault (`createVault` con tag) y responde con la dirección, el link de cobro y el resumen de límites. La tx sale en el `ops.jsonl` del agente.
2. Abrir el link de cobro `/?vault=0x…&amount=100` y pagar con wARS desde una wallet en Celo mainnet (MiniPay, Valora o inyectada). El pago x402 lo liquida el facilitador por Permit2 — el cliente no paga gas ni necesita CELO.
3. Verificar, en este orden:
   - **Telegram:** llega `Entró una venta: $100 ✓` al chat del dueño (schedule `avisos_ventas`, tarda hasta ~1 min).
   - **Comprobante:** `/comprobante?tx=0x<hash del pago>` muestra el pago verificado contra la cadena.
   - **Panel:** `/panel?vault=0x<vault>` muestra el día con la venta cobrada.
   - **Indexer:** `GET /events` muestra `venta_cobrada` y `GET /sales/:id` la venta en `cobrada`.
4. **Attribution tag de cada tx del agente** (alta, apartados, dolarizar, deploy, registro). Desde `agent/`:

```powershell
node --input-type=module -e "import {verifyTx} from '@celo/attribution-tags'; import {createPublicClient,http} from 'viem'; import {celo} from 'viem/chains'; const t = await verifyTx({client: createPublicClient({chain: celo, transport: http()}), hash: '0x<tx>'}); console.log(t?.codes)"
# esperado: [ 'celo_c376b2fd04bc' ]
```

Las tx de pago x402 **no** llevan el tag (las manda el facilitador): la entrega informa las wallets PayTo (los vaults) — regla de `AGENTS.md`.

## 8. Checklist final de la entrega

- [ ] `contracts/deployments/celo.json` commiteado con `factory`, `factoryBlock`, `factoryTx`, `commit`, `bytecodeHash` y `agentId`.
- [ ] `agentId` ERC-8004 de mainnet anotado (del `celo.json`) y visible en 8004scan.
- [ ] Wallet del agente `0x2B7c25FedB6d09e149fedc1ffE35529b1cab1f65` anotada como identidad del agente.
- [ ] Wallets PayTo: la dirección de cada vault creado por `/start` (los pagos x402 no llevan tag).
- [ ] Gas sponsoreado documentado: el equipo paga el gas del agente en USD₮ por fee abstraction (no es aporte propio del código — se declara en la entrega, `AGENTS.md` regla 7).
- [ ] Tag `celo_c376b2fd04bc` verificado en cada tx del agente con el comando del paso 7.
- [ ] `docs/comercio.md`: sacar las marcas `[PENDIENTE MAINNET]` que ya quedaron obsoletas (creación de cajas, pago con billetera).
- [ ] Verificación de contratos en el explorador (paso 3).

## 9. Qué NO hacer

- **No setear `TILDAI_OPEN_SIGNUP=1`** mientras `devin-agent` no cierre el hallazgo G del alta. Las altas entran por `TILDAI_ALLOWED_CHATS` (o por el equipo, acompañando cada `/start`).
- **No setear `TILDAI_DEMO`**: es un bypass solo de desarrollo local. En 42220 el código ya la ignora para validar vaults, pero no tiene que existir en un entorno de mainnet.
- **No re-correr el deploy "a mano"** ni mandar otra tx de deploy: ante un corte siempre es volver a correr `deploy-mainnet.ts` y dejar que decida (paso 2). Nunca borrar `celo.json`.
- **No usar `deployContract`** de viem para nada: `withAttribution` no lo envuelve y la tx saldría sin tag. Siempre `sendTransaction({ data, feeCurrency, nonce })` + `verifyTx`.
- **No commitear** `agent/.env`, claves, seeds ni capturas con valores secretos. `celo.json` sí se commitea (solo tiene direcciones y hashes).
- **No mover plata sin tag**: cualquier script nuevo que mande tx va por `agentClients()` de `agent/src/chain.ts`.
