# AGENTS.md - Contexto para agentes de código

Leé este archivo antes de trabajar en el proyecto. Para el detalle completo (idea, arquitectura, plan y tareas) leé **`idea.md`**, que es el documento maestro.

## Proyecto
- **Nombre:** Tildai ("cada cobro, tildado").
- **Qué es:** agente de caja para comercios de barrio en Argentina. Cobra en **wARS** (peso argentino onchain de Ripio) sobre **Celo mainnet**, avisa cada venta por Telegram, hace el cierre de caja diario, aparta ahorro e impuestos y dolariza el excedente en Textile FX.
- **Hackathon:** Agents on Open Rails (Loops House × Celo). Track principal: *Stable Agents: LatAm (Ripio × Celo)*. Secundario: *Open Corridors: Textile FX*.
- **Deadline:** lunes 9/11/2026, 06:00 hora argentina (09:00 GMT).

## Archivos
| Archivo | Para qué |
|---|---|
| `idea.md` | Documento maestro: idea, arquitectura, flujos, plan semanal con checklist de tareas, riesgos y decisiones pendientes |
| `contexto.md` | Información general de la hackathon (tracks, recursos, links) |
| `AGENTS.md` | Este archivo: reglas y contexto rápido para agentes |
| `CLAUDE.md` | Importa este archivo y fija las skills de Claude Code |
| `.claude/skills/` | Skills del proyecto (ver "Skills del proyecto") |
| `GLOSSARY.md` y `docs/adr/` | Los genera `grill-with-docs`: lenguaje compartido y decisiones de arquitectura |

**Stack:** TypeScript en todo (agente, web, scripts, viem) y Solidity para contratos. Web en Next.js (decidido; no usar Astro para la página de cobro).

**Estructura de código planeada** (todavía no existe):
- `contracts/`: Solidity, `TildaiVault` y `TildaiFactory`.
- `agent/`: agente eve con tools, schedules y canal Telegram.
- `web/`: Next.js, página de cobro x402 y QR.

## Reglas obligatorias (no negociables)
1. **Solo Celo mainnet cuenta** (chain `42220`). Para pruebas se puede usar Celo Sepolia (`11142220`), pero el entregable va en mainnet.
2. **Attribution tag ERC-8021 en TODAS las tx** que envíe el agente o el frontend, **desde la primera**. No se puede agregar retroactivamente. Va en el cliente de wallet (viem), no en el contrato. SDK: github.com/celo-org/attribution-tags
3. **El agente necesita identidad ERC-8004** registrada desde su propia wallet.
4. **Repo público en GitHub.** Todo el código se escribe durante la hackathon.
5. **Nunca commitear claves privadas, API keys ni seeds.** Usar `.env` (y `.env.example` sin valores) y mantener `.env` en `.gitignore`.
6. Los pagos x402 no llevan tag: se informa la wallet PayTo (los vaults) en la entrega.
7. Si sponsoreamos gas, documentarlo (no cuenta como aporte nuestro).

## Constantes técnicas
- **wARS:** `0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d` (18 decimales, misma dirección en todas las EVM).
- **wARS no es fee currency** en Celo: el agente paga gas en USD₮/USDC vía fee abstraction (usar la dirección del *adapter* en `feeCurrency`).
- **x402:** facilitador `https://api.x402.celo.org` (mainnet). wARS se liquida por **Permit2**: la ruta debe incluir `assetTransferMethod: "permit2"` y el dominio EIP-712 `{ name: "Peso Argentino", version: "1" }`. Guía oficial: https://x402.celo.org/skill.md. Paquetes: `@x402/express @x402/core @x402/evm`.
- **Ripio ramps** (sin credenciales):
  - On-ramp: `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=X&address=0x...`
  - Off-ramp: `/offramp` con los mismos parámetros.
- **Textile FX:** app.textilecredit.com (RFQ wARS ⇄ USD₮).
- **Framework del agente:** eve (Vercel), Node 24+. Docs: https://eve.dev/llms.txt. WhatsApp vía `@chat-adapter/whatsapp` (Chat SDK).
- **Skills útiles:** `npx skills add celo-org/celopedia-skills` (direcciones verificadas de Celo) y `npx loopshouse add agents-on-open-rails`.

## Principios de diseño
- **El agente no custodia fondos.** Los fondos están en el `TildaiVault` del comercio. El agente solo puede moverlos a destinos permitidos (alcancía, wallet de retiro del dueño, Textile), con tope diario. El dueño siempre puede retirar todo.
- **La parte que mueve plata es código determinístico con límites.** El LLM interpreta pedidos y redacta mensajes, pero no decide montos fuera de las reglas.
- **UX para no cripto:** sin seed phrases, sin gas para el cliente, todo en pesos y en español rioplatense.
- **MVP primero en Telegram.** WhatsApp es opcional.

## Errores y plata
Ante la duda, no mover fondos. Es un borrador del equipo: revisalo antes de darlo por definitivo.
- **Cobro:** una venta se marca como cobrada solo con el evento `Transfer` confirmado onchain. Si falla el RPC o el indexador, queda "pendiente", nunca "cobrada".
- **Dolarización:** si falla o vence la cotización de Textile FX, no se convierte y se avisa al dueño. Nunca usar una tasa por defecto ni una cotización vieja.
- **Reintentos idempotentes:** toda operación que mueve plata (apartar, retirar, dolarizar) lleva un id único. Antes de reintentar, verificar onchain si la tx anterior ya se ejecutó.
- **Topes y registro:** respetar siempre el tope diario del vault. Cada tx del agente deja un registro con id, monto, destino y resultado.
- **Fallas silenciosas prohibidas:** no tragar errores con `catch` vacío. Un error de plata se registra y se avisa por Telegram.
- **Depuración:** reproducir y hallar la causa raíz antes de arreglar (`diagnosing-bugs`). Si fallan 3 arreglos seguidos, parar y revisar el diseño con el equipo antes de intentar un cuarto.

## Skills del proyecto
Viven en `.claude/skills/<nombre>/SKILL.md`. Si tu CLI no las carga solo (Antigravity, Devin), leé el SKILL.md de la que corresponda antes de la tarea.

| Skill | Cuándo usarla |
|---|---|
| `ponytail` | En toda tarea de código: la solución más chica que resuelva el problema completo |
| `ponytail-review` | Antes de cada commit o PR |
| `ponytail-audit` / `ponytail-debt` | Auditoría del repo y listado de atajos (`shortcut:`). Al final de cada semana |
| `grill-with-docs` | Antes de diseñar algo no trivial (contratos, flujos de cobro). Actualiza `GLOSSARY.md` y `docs/adr/` |
| `diagnosing-bugs` | Cualquier bug no obvio: primero reproducir, después arreglar |
| `handoff` | Al pasar el trabajo a otro agente o CLI |

Reglas de convivencia:
- **Ponytail no recorta nada que toque plata.** En `contracts/`, firma de tx, x402 y límites del vault: validación, manejo de errores, tests y tope diario son obligatorios, aunque agranden el diff.
- Todo atajo lleva un comentario `shortcut: <límite>, <cuándo mejorarlo>`.
- `idea.md` sigue siendo el documento maestro. `GLOSSARY.md` fija el vocabulario (vault, cobro, cierre de caja) y los ADR registran decisiones puntuales.
- Antes de tocar `contracts/`: `grill-with-docs`, luego `ponytail-review`.
- No instalar plugins con hooks ni skills nuevas sin avisar al equipo.

## Cómo trabajar
- Antes de diseñar usá `grill-with-docs`; antes de cerrar, `ponytail-review`. Revisá el plan semanal en `idea.md` (sección 8) y marcá `[x]` lo que completes.
- Con varios CLI: cada agente trabaja en su worktree y entrega con `handoff`.
- Si tomás una decisión de arquitectura o se resuelve una "decisión pendiente", actualizá `idea.md` y este archivo.
- Verificá direcciones de contratos con Celopedia o la documentación oficial. No las inventes.
- Idioma: documentación y mensajes al usuario en **español rioplatense**. Código e identificadores en inglés.
- No hagas push ni deploy a mainnet sin confirmación del equipo.

## Estado actual (17/10/2026)
- Idea, nombre y plan definidos. **Todavía no hay código.**
- Próximo paso: semana 0 (inscripción, attribution tag, repo, wallet del agente, ERC-8004, validación con comercios y liquidez en Textile).
