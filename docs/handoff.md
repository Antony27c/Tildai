# Traspaso del rol de coordinador (18/10/2026)

Quien lea esto toma el rol de **coordinador** de Tildai: reparte tareas a los agentes, revisa su código antes de mergear y protege las reglas de `AGENTS.md`. Lo hacía Claude; sigue Devin. Antes de nada leé `AGENTS.md` e `idea.md`.

## Estado de `main`
Los PRs #1 a #9 están mergeados. Hay código real, pero **todo trabaja con datos falsos**:

| Carpeta | Qué hay | Tests |
|---|---|---|
| `agent/` | Agente eve con canal de Telegram, tools `crear_cobro`, `ventas_hoy`, `aviso_pago` y cierre de caja. Vault falso en memoria. `scripts/generate-wallet.ts` crea la wallet del agente | `cd agent && node --test` |
| `web/` | Next.js: página de cobro, QR, link de Ripio. Solo acepta vaults de `TILDAI_VAULTS` (o cualquiera con `TILDAI_DEMO=1`). `payWithX402` devuelve rechazado | `cd web && npm test && npm run build` |
| `indexer/` | Lee `Transfer` de wARS hacia vaults y concilia ventas. Store en memoria | `cd indexer && node --test` |
| `fx/` y `docs/textile-fx.md` | Cotización indicativa de Textile FX y análisis de liquidez | `cd fx && node --test` |

**Falta lo más importante:** los contratos `TildaiVault` y `TildaiFactory` (`contracts/`). Nadie los empezó. Antes de escribirlos leé "Requisitos del vault" en `idea.md`: quién firma el swap (EIP-1271), tasa mínima y topes onchain, y el poco volumen real de Textile. Proponé el diseño al dueño y esperá su OK antes de desplegar nada.

También pendiente: apartado de ahorro e impuestos, dolarización, x402 real (Permit2 y facilitador), persistencia (todo está en memoria, con comentarios `shortcut:`), `TILDAI_OWNER_CHAT_ID` y el token de Telegram.

## Hackathon (Loops House)
- Entrega: **lunes 9/11/2026, 06:00 hora argentina**. Solo cuenta Celo mainnet.
- Cuenta de Loops: `antoniochocobar.sam@gmail.com`, ya inscripta. CLI `loops` instalada global. **Attribution tag: `celo_c376b2fd04bc`** (va en todas las tx, desde la primera).
- Todavía **no hay proyecto creado** en Loops, ni wallet del agente, ni ERC-8004. El dueño debe: correr `cd agent && npm run wallet` (la clave queda en `agent/.env`, nunca se comparte), fondear la wallet con gas y pasar solo la dirección pública.
- Para la entrega: `loops project fields --event agents-on-open-rails`, luego `project create` **sin `--confirm`** (es un borrador), mostrárselo al dueño y confirmar solo con su sí explícito. Campo obligatorio: `agent-wallet`.
- Las skills de Loops House están sin commit en la carpeta del Desktop (`.agents/` y `.claude/skills/loops-agents-on-open-rails`).

## Cómo se trabaja
- **Un worktree por agente**, carpeta `C:/Users/pansi/orca/workspaces/BuilderSession/<nombre>`, rama `Antony27c/<nombre>`: `devin-agent`, `devin-web`, `devin-indexer`, `gemini-textile`, y `Tildai` (coordinador). Los viejos `copepod`, `triggerfish`, `rosefish`, `hind` y `lookdown` parten del historial anterior a la reescritura: no los uses sin moverlos al `main` nuevo.
- **Crear un hilo:** `orca worktree create --name X --repo "path:C:/Users/pansi/Desktop/BuilderSession" --base-branch origin/main --setup skip`, y luego `orca terminal create --worktree "path:<carpeta>" --title X --command "devin --permission-mode dangerous"`. Gemini: `--agent antigravity` al crear el worktree.
- **Controlar agentes:** `orca terminal list`, `read --screen`, `show`, `send --text ... --enter`, `wait --for tui-idle`. Para orquestación supervisada usá `orca skills get orchestration`. Los handles de terminal cambian en cada sesión.
- **Tareas:** cada una dice objetivo, qué cambiar, límites, qué carpetas puede tocar y cómo se comprueba. Siempre: sin transacciones, sin claves, sin push, commits sin marcas.
- **Permisos de Devin:** pide aprobar descargas y comandos; la opción "Yes, switch to bypass mode" (tecla 5, luego Enter) lo deja sin pedir. Al reabrir una sesión con `-r` el modo no se hereda. Si el proceso de Devin termina, el terminal queda muerto: hay que cerrarlo y crear otro con `-r <id-de-sesión>`. Devin pide confiar en la carpeta la primera vez.
- **Reglas técnicas:** `core.hooksPath` debe ser `.githooks` en cada clon. `commit-msg` borra `Co-Authored-By` y `Generated with`. `pre-push` bloquea las ramas `devin-*` y `gemini-*` salvo `TILDAI_ALLOW_PUSH=1` (solo con autorización del dueño).
- **Ponytail no recorta nada que toque plata:** validación, manejo de errores, tests y topes siempre.

## Cómo revisar el código de los agentes
Corré sus tests y probá los casos a mano; no te fíes del resumen. Fallas reales que ya aparecieron:
- Conciliar un pago con una venta anterior a él (falso "cobrada").
- Aceptar cualquier dirección de vault desde la URL.
- Interpretar "8.500" como 8,5 pesos (el punto es separador de miles en Argentina).
- Funciones simuladas que devuelven "pagado" (`payWithX402`, `simular_pago`).
- Documentos que exageran: Textile tiene cotización pero casi cero operaciones.
Verificá direcciones de contratos con la fuente oficial; no confíes en la memoria de un agente.

## Cosas del entorno a tener en cuenta
- La carpeta del Desktop (`C:/Users/pansi/Desktop/BuilderSession`) tiene su rama `main` local en un historial viejo. Para igualarla: `git fetch origin && git reset --hard origin/main` (confirmá antes que no haya nada sin subir; los archivos de Loops House son sin commit y no se pierden).
- En el repo se reescribió el historial una vez (para sacar un `Co-Authored-By` del primer commit). Quedan ramas locales `backup-antes-reescritura-main` y `backup-antes-reescritura-tildai` con el historial viejo; se pueden borrar.
- En Windows, `.gitattributes` fuerza LF en `.githooks/*`; sin eso los hooks se rompen.
