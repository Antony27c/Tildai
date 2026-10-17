# Tildai

**Cada cobro, tildado.**

Tildai es un agente de caja para comercios de barrio en Argentina. Cobra en **wARS** (el peso argentino onchain de Ripio) sobre **Celo mainnet**, avisa cada venta por Telegram, hace el cierre de caja todos los días, aparta ahorro e impuestos y protege el excedente pasándolo a dólares.

Proyecto para la hackathon **Agents on Open Rails** (Celo × Ripio, vía Loops House).

> **Estado:** en desarrollo. Hoy el repo tiene la documentación y el plan; el código todavía no existe.

## El problema

Un comercio chico argentino paga entre 4 y 6% más IVA por cobrar con posnet o billeteras, espera días la acreditación, lleva la caja a mano, no ahorra porque la plata se mezcla y pierde poder adquisitivo con la inflación.

## Qué hace Tildai

- **Cobra en pesos onchain**: el cliente escanea un QR y paga en wARS sin pagar gas (x402). Si no tiene cripto, puede pagar con pesos vía el on-ramp de Ripio.
- **Avisa cada venta** por Telegram: "✓ Entraron $8.500 (venta #23)".
- **Cierra la caja solo** todos los días a las 21 hs: total, cantidad de ventas, ticket promedio y comparación con el mismo día de la semana anterior.
- **Aparta ahorro e impuestos** según las reglas del dueño.
- **Dolariza el excedente** en Textile FX si el dueño lo autorizó.
- **Retira a pesos** por el off-ramp de Ripio cuando el dueño lo pide.
- **Responde consultas** en lenguaje natural: "¿cuánto vendí hoy?", "¿cuánto tengo en dólares?".

## Cómo se usa

| Quién | Cómo |
|---|---|
| **El dueño del comercio** | Chatea con el agente por Telegram: "cobrame 8.500", "pasame 50.000 al banco". |
| **El cliente** | Escanea el QR del mostrador y paga desde una página web mobile. |
| **Otros agentes o tiendas online** (fase 2) | Pagan al comercio con una API x402. |

## Principios de diseño

- **El agente no custodia fondos.** La plata está en un contrato (`TildaiVault`) propio de cada comercio. El agente solo puede moverla a destinos permitidos, con tope diario, y el dueño siempre puede retirar todo.
- **Lo que mueve plata es código determinístico con límites.** El LLM interpreta pedidos y redacta mensajes, pero no decide montos fuera de las reglas.
- **Pensado para quien no usa cripto:** sin seed phrases, sin gas para el cliente, todo en pesos y en español rioplatense.

## Arquitectura

```
Cliente (celular) ──QR──► Página de cobro (Next.js) ──x402──► Facilitador x402 de Celo
                                    │
Dueño ──Telegram──► Agente Tildai (eve) ──► TildaiVault (Celo mainnet, uno por comercio)
                         │
                         └──► Textile FX (wARS ⇄ USD₮)
```

| Carpeta (planeada) | Qué es |
|---|---|
| `contracts/` | Solidity: `TildaiVault` y `TildaiFactory` |
| `agent/` | Agente en eve (Vercel): tools, schedules y canal de Telegram |
| `web/` | Next.js: página de cobro x402 y QR |

**Stack:** TypeScript en todo (agente, web, viem) y Solidity para los contratos.

## Hackathon

- **Track principal:** Stable Agents: LatAm (Ripio × Celo).
- **Track secundario:** Open Corridors: Textile FX.
- **Cierre de entrega:** lunes 9/11/2026, 06:00 (hora argentina).
- Solo cuenta Celo mainnet (chain `42220`). El agente tiene identidad ERC-8004 y cada transacción lleva attribution tag ERC-8021.

## Documentación

| Archivo | Contenido |
|---|---|
| [`idea.md`](idea.md) | Idea completa, arquitectura, flujos, plan semanal, riesgos y decisiones pendientes |
| [`contexto.md`](contexto.md) | Información de la hackathon: tracks, reglas y recursos |
| [`AGENTS.md`](AGENTS.md) | Reglas y contexto para agentes de código |
