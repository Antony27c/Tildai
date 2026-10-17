# Contexto: Hackathon "Agents on Open Rails" (Celo × Ripio)

## Resumen
- Hackathon global de Celo: **US$5.000 en premios**, mentorías y 3 meses gratis del plan Growth de Chainstack para proyectos seleccionados.
- Link: https://loops.house/agents-on-open-rails
- Builder Session presencial (2 hs, cafetería, Argentina) organizada por Celo y Ripio: intro a la hackathon, workshop en vivo, demo práctica y espacio para dudas.
- Slides y "prompt maestro" para coding agents: https://arturogrande.com/builder-session
- Dudas (en inglés): Telegram https://t.me/realworldagentshackathon

## Fechas y reglas clave (según la página oficial)
- Cierre de inscripción y entrega: **lunes 9/11, 06:00 hora argentina**. Ganadores: viernes 13/11.
- Solo cuenta Celo mainnet (42220). Repo público en GitHub desde la inscripción. Código escrito durante la hackathon.
- Obligatorio: identidad ERC-8004 del agente (8004scan.io) y attribution tag ERC-8021 en cada tx (github.com/celo-org/attribution-tags). En x402 se informa la wallet PayTo.
- Se puede entrar en varios tracks (un premio por track por equipo).
- Usuarios independientes: wallets ajenas, no fondeadas por vos y con actividad en Celo previa a la hackathon.
- Stack sugerido: Celopedia (`npx skills add celo-org/celopedia-skills`), eve de Vercel, skill de la hackathon (`npx loopshouse add agents-on-open-rails`).

## Tracks
1. **Stable Agents: LatAm (Ripio × Celo)** - $1.500 / $500. Cobrar, pagar, ahorrar y liquidar en wARS, wBRL, wMXN, wCOP, wPEN y wCLP.
2. **Open Corridors**
   - 2A **Textile FX** - $750 / $250. Cotizar y liquidar FX en app.textilecredit.com. Se juzga por P&L, volumen y originalidad.
   - 2B **USA₮ con x402** - $750 / $250. Liquidación real entre partes independientes vía x402.celo.org.
3. **Build with buy** (usebuy.ai) - $1.000 entre 5 proyectos. Productos que pagan por servicios ajenos (VMs, browsers, datos, inferencia). `npm i -g @celo/buy`.

## Decisión
- **Track elegido: 1 - Stable Agents: LatAm (Ripio × Celo).**
- Proyecto: **Tildai**, un agente de cobro y cierre de caja para comercios de barrio en wARS. Documento maestro: `idea.md`.
- Segundo track candidato: **2A Textile FX** (dolarización automática del ahorro del comercio). Alternativa: 2B USA₮ x402 (turistas).

## Stablecoins wFiat (misma dirección en cadenas EVM, incluida Celo; 18 decimales)
| Token | Dirección |
|---|---|
| wARS | 0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d |
| wBRL | 0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0 |
| wMXN | 0x337e7456b420bd3481e7fa61fa9850343d610d34 |
| wCOP | 0x8a1d45e102e886510e891d2ec656a708991e2d76 |
| wPEN | 0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE |
| wCLP | 0x61D450a098b6a7f69fC4b98CE68198fe59768651 |

Precios en CoinGecko: slugs `argentine-peso`, `brazilian-real`, `mexican-peso`, `colombian-peso`, `peruvian-sol`, `chilean-peso`.

## On/off-ramps (Ripio)
- **Ramps API**: https://docs.ripio.com - onboarding en https://platform.ripio.com (due diligence + KYB, solo empresas).
- **ramp.ripio.com con query params** (lo más fácil, sin credenciales):
  - `/` = on-ramp, `/offramp` = off-ramp.
  - Params: `country`, `chain`, `token`, `amount`, `address` (wallet destino). Con los cuatro primeros el usuario salta el formulario; si no, solo precarga.
  - Redes/tokens disponibles dependen del país.
  - Ejemplo: `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=10000&address=0x...`
- Celo mainnet chain ID: 42220.

## Bridge
- dapp: https://bridge.ripio.com - docs para integrar: https://bridge.ripio.com/developers

## Ideas iniciales (a definir)
- Agente que cobra/paga en wARS y hace on/off-ramp vía URL de Ripio.
- Agente de remesas/corredores LatAm entre wARS/wBRL/wMXN, etc.
- Agente comprador que paga APIs/cómputo vía x402 en *buy*.

## Próximos pasos
- [ ] Elegir track e idea
- [ ] Leer la página de la hackathon (reglas, fechas, criterios de entrega)
- [ ] Revisar slides y prompt maestro
- [ ] Unirse al Telegram
- [ ] Crear wallet en Celo y fondear (testnet/mainnet)
- [ ] Prototipo, demo y submission
