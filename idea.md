# Tildai - cada cobro, tildado

> Agente de caja para comercios de barrio que cobra en pesos onchain (wARS) sobre Celo.
> Hackathon **Agents on Open Rails** (Celo × Ripio). Track principal: **Stable Agents: LatAm**. Track secundario: **Open Corridors: Textile FX**.
> **Cierre de entrega:** lunes 9/11/2026, 06:00 (hora argentina). Última revisión: 17/10/2026.

---

## 1. El nombre

**Tildai** viene de *tildar*: marcar con un tilde (✓) lo cobrado, como la lista del almacenero. Suena a "tildái" (voseo: *vos tildás*), y el "-ai" sugiere agente sin decirlo explícitamente. Se pronuncia fácil en inglés ("til-dai").

- **Tagline:** *"Tildai: cada cobro, tildado."*
- **Logo:** un tilde ✓ integrado en la tipografía.

**Disponibilidad (verificada el 17/10):**
| Recurso | Estado | Acción |
|---|---|---|
| `tildai.com` | Ocupado | No usar |
| `tildai.app`, `tildai.ar`, `tildai.com.ar`, `tildai.xyz`, `tildai.io`, `tildai.ai` | Sin DNS, probablemente libres | Confirmar y registrar `.app` o `.ar` |
| GitHub `@tildai` | Ocupado (cuenta casi vacía) | Usar una org tipo `tildai-app` o `tildai-agent` |
| Telegram `@tildai_bot` y `@tildaibot` | Ocupados | Probar `@TildaiCajaBot` o `@TildaiAgentBot` |
| Marca (INPI) | Sin verificar | Consultar clases 36 y 42 |

---

## 2. Qué es

> **Tildai atiende la caja de un comercio de barrio: cobra en wARS, avisa cada venta por Telegram/WhatsApp, cierra la caja solo todos los días, aparta ahorro e impuestos y protege el excedente pasándolo a dólares.**

### Un agente con tres caras
| Cara | Quién la usa | Qué es | Prioridad |
|---|---|---|---|
| **Chat del comercio** | El dueño | Bot de **Telegram** (MVP) y luego **WhatsApp**. Ahí habla con el agente: "cobrame 8.500", "¿cuánto vendí hoy?", "pasame 50.000 al banco" | MVP |
| **Página de cobro (QR / link)** | El cliente | Web mobile que se abre al escanear el QR del mostrador. Paga en wARS **sin pagar gas** (x402 vía Permit2). Si no tiene cripto, botón "Pagar con pesos" (on-ramp de Ripio) | MVP |
| **API de cobro x402** | Otros agentes y tiendas online | Endpoint x402 para que un agente o e-commerce le pague al comercio. Más adelante, SDK/widget | Fase 2 |

### Por qué es un agente y no un bot
El agente decide y actúa solo, siempre dentro de los límites que fija el contrato onchain:
- Detecta pagos onchain y concilia cada venta.
- Hace el **cierre de caja** diario por cron (21 hs).
- Aparta el % de **ahorro e impuestos** según las reglas del dueño.
- Avisa anomalías ("hoy vendiste 40% menos que un martes normal").
- **Dolariza el excedente** en Textile FX si el dueño lo autorizó.

---

## 3. Problema, beneficio y público

- **Problema:** el comercio chico argentino paga entre 4 y 6% más IVA por cobrar con posnet o billeteras, espera días la acreditación, lleva la caja a mano, no ahorra porque "la plata se mezcla" y pierde poder adquisitivo con la inflación.
- **Beneficio:**
  - Comisión de 0,5 a 1%.
  - Acreditación instantánea.
  - Cierre de caja automático.
  - Ahorro e impuestos apartados solos.
  - Excedente en dólares.
  - Retiro a pesos vía Ripio.
- **Público principal:** kioscos, verdulerías, peluquerías, cafeterías, food trucks, puestos de feria y emprendedores.
- **Público secundario (opcional):** turistas que pagan en USA₮.
- **Ventaja del equipo:** estamos en Argentina y podemos sumar **comercios reales** para la demo y las métricas.

## 4. Modelo de negocio
1. **Comisión por cobro** de 0,5 a 1%, descontada onchain en el contrato.
2. **Tildai Pro** (mensual en wARS): reportes, exportación para el contador, varias cajas o empleados, alertas avanzadas.
3. **Fee sobre la dolarización:** un spread chico sobre lo que el agente convierte a USD₮.
4. **Fase 2:** fee por uso de la API x402.

---

## 5. Arquitectura

```
 Cliente (celular)              Comercio (dueño)
       │ escanea QR                   │ chatea
       ▼                              ▼
 Página de cobro (Next.js)      Telegram / WhatsApp (Chat SDK)
       │ x402 (wARS, Permit2,          │
       │ sin gas para el cliente)      ▼
       │                     ┌────────────────────────────┐
       └────────────────────►│   Agente Tildai (eve)      │
                             │  tools: crear_cobro,       │
   Facilitador x402 Celo ◄───│  ventas_hoy, cierre_caja,  │
   (api.x402.celo.org)       │  apartar, retirar,         │
                             │  dolarizar (Textile FX)    │
   Textile FX ◄──────────────│  schedules: cierre 21 hs   │
   (wARS ⇄ USD₮)             └────────────┬───────────────┘
                                          │ tx con attribution tag (ERC-8021)
                                          ▼
                       Celo mainnet: TildaiVault (uno por comercio)
                       (recibe wARS · reglas de ahorro/impuestos ·
                        el agente solo mueve a destinos permitidos)
```

### Componentes
| Componente | Tecnología | Notas |
|---|---|---|
| Agente | **eve** (Vercel) + LLM | Tools en TypeScript, schedules con cron, deploy en Vercel. Node 24+ |
| Chat del comercio | **Telegram** (canal nativo de eve) y luego **WhatsApp** (`@chat-adapter/whatsapp`) | WhatsApp requiere app de Meta Business y tiene una ventana de 24 hs |
| Página de cobro | Next.js + viem + `@x402/express` `@x402/core` `@x402/evm` | wARS usa **Permit2** (`assetTransferMethod: "permit2"`, dominio EIP-712 `{ name: "Peso Argentino", version: "1" }`). El facilitador paga el gas |
| Contratos | `TildaiVault` + `TildaiFactory` (Solidity, verificados) | El dueño puede retirar todo. El agente solo puede mover a la alcancía, a la wallet de retiro del dueño o a Textile, con tope diario |
| Wallets | Dueño: passkey / smart wallet (por ejemplo, Para). Agente: wallet propia | El agente tiene **ERC-8004** registrado desde su wallet |
| Gas del agente | Fee abstraction en **USD₮/USDC** (adapter) | wARS **no** es fee currency en Celo |
| Indexación | Eventos `Transfer` de wARS hacia cada vault | RPC de Chainstack (3 meses gratis del plan Growth) |
| FX | **Textile FX** (app.textilecredit.com) | RFQ wARS ⇄ USD₮ |
| Off-ramp | `https://ramp.ripio.com/offramp?country=AR&chain=42220&token=WARS&amount=X&address=<wallet>` | El dueño completa en Ripio |
| On-ramp del cliente | `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=X&address=<vault>` | Botón "Pagar con pesos" |

### Datos técnicos clave
- **Red:** Celo mainnet, chain ID `42220` (CAIP-2 `eip155:42220`). Testnet Celo Sepolia `11142220`.
- **wARS:** `0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d` (18 decimales).
- **Facilitador x402:** `https://api.x402.celo.org` (mainnet) y `https://api.x402.sepolia.celo.org` (testnet, solo USDC). La API key se saca en x402.celo.org e incluye 20 settlements gratis. Después cobra gas + 0,3%. Guía: https://x402.celo.org/skill.md
- **Attribution tags (ERC-8021):** github.com/celo-org/attribution-tags. El tag lo da Loops House al inscribirse.
- **ERC-8004:** docs.celo.org/build-on-celo/build-with-ai/8004. Explorador: 8004scan.io
- **Herramientas:** `npx skills add celo-org/celopedia-skills`, `npx loopshouse add agents-on-open-rails`, `npx eve@latest init tildai`.

---

## 6. Flujos del MVP

1. **Alta del comercio:** el dueño escribe /start en Telegram. El agente crea su `TildaiVault` (tx con tag), le da su QR fijo y le pregunta sus reglas (% de ahorro e impuestos, umbral de dolarización).
2. **Venta con monto:** "cobrame 8.500". El agente genera el link/QR, el cliente firma el pago en wARS sin gas y el agente avisa "✓ Entraron $8.500 (venta #23)".
3. **QR fijo del mostrador:** el cliente ingresa el monto y paga. El agente concilia igual.
4. **Cierre de caja (cron 21 hs):** total, cantidad de ventas, ticket promedio y comparación con el mismo día de la semana anterior. Después aparta el % de ahorro e impuestos.
5. **Dolarización:** si el excedente supera el umbral, el agente pide cotización en Textile FX, convierte wARS → USD₮ y lo reporta.
6. **Retiro:** "pasame 50.000 al banco". El agente mueve a la wallet de retiro y devuelve el link de off-ramp de Ripio.
7. **Consultas libres:** "¿cuál fue mi mejor día del mes?", "¿cuánto tengo en dólares?".

---

## 7. Tracks y cómo ganarlos

| Track | Cómo encaja Tildai | Se evalúa |
|---|---|---|
| **Stable Agents: LatAm** (principal, $1.500 / $500) | Cobro, conciliación, ahorro y retiro en wARS para comercios. Es lo que pide Ripio: *"merchant agents that invoice, collect, and reconcile"* | Mainnet con wFiat real · uso real de wFiat + Celo · agente autónomo y útil · UX usable · impacto en LatAm |
| **Open Corridors: Textile FX** (secundario, $750 / $250) | Dolarización automática del excedente. El track pide *"treasury agents that manage a business's currency exposure"* | P&L · volumen cotizado y ejecutado · originalidad |
| USA₮ con x402 (opcional) | Aceptar USA₮ de turistas en la misma página de cobro | Liquidación entre partes independientes · moneda justificada |

**Cómo sumar puntos:**
- Generar tx reales con tag desde el día 1.
- Usar x402 en wARS, fee abstraction, ERC-8004 y los ramps de Ripio.
- Cierre de caja y dolarización sin intervención humana.
- Telegram + QR, sin seed phrases.
- Comercios reales con métricas.
- En Textile, vender la originalidad: tesorería para comercios de barrio.

**Usuario independiente:** wallet ajena, no fondeada por nosotros y con actividad en Celo previa a la hackathon. Se cuentan firmantes. Los usuarios nuevos no descalifican, pero hay que explicar el origen de los usuarios en la entrega.

---

## 8. Plan de trabajo y tareas

### Semana 0 - Setup y validación (sáb 17 al dom 19/10)
- [ ] Inscribirse en Loops House (loops.house/agents-on-open-rails, "Enroll now") y obtener el **attribution tag**
- [ ] Crear la org/repo público en GitHub (`tildai-app/tildai`) y vincularlo a la entry
- [ ] Instalar skills: `npx loopshouse add agents-on-open-rails` y `npx skills add celo-org/celopedia-skills`
- [ ] Crear la wallet del agente (clave en `.env`, nunca en el repo) y agregarla a la entry
- [ ] Registrar la identidad **ERC-8004** del agente desde su wallet
- [ ] Fondear: wARS (Ripio), USD₮ para gas (faucet de Google Cloud Web3 con Self)
- [ ] Sacar la API key del facilitador en x402.celo.org
- [ ] Validar la liquidez wARS/USD₮ en Textile FX (decide el track 2A o 2B)
- [ ] Hablar con **3 a 5 comercios** y anotar nombre, rubro y su dolor principal
- [ ] Registrar el dominio y el handle de Telegram (`@TildaiCajaBot`)
- [ ] Definir el equipo y los roles

### Semana 1 - Cobro onchain (lun 20 al dom 26/10)
- [ ] Scaffold del monorepo: `contracts/`, `agent/` (eve), `web/` (Next.js)
- [ ] Integrar el SDK de attribution tags en el cliente de wallet (antes de cualquier tx)
- [ ] `TildaiVault` + `TildaiFactory`: depósitos, reglas (% ahorro/impuestos), destinos permitidos, tope diario y retiro del dueño
- [ ] Tests de contratos y deploy en Sepolia, luego **mainnet + verificación**
- [ ] Página de cobro con x402 en wARS (Permit2), con monto dinámico y QR fijo
- [ ] Botón "Pagar con pesos" con on-ramp de Ripio hacia el vault
- [ ] Indexador de eventos `Transfer` de wARS hacia los vaults
- [ ] Bot de Telegram básico: /start (crea vault), "cobrame X" (genera link/QR), aviso de pago recibido
- [ ] **Primer cobro real en mainnet**

### Semana 2 - Agente autónomo (lun 27/10 al dom 2/11)
- [ ] Agente en eve con tools: `crear_cobro`, `ventas_hoy`, `cierre_caja`, `apartar`, `retirar`, `dolarizar`
- [ ] Schedule de **cierre de caja** a las 21 hs con resumen y comparación semanal
- [ ] Apartado automático de ahorro e impuestos después del cierre
- [ ] Retiro: mover a la wallet del dueño y generar el link de off-ramp de Ripio
- [ ] Integración con **Textile FX**: cotizar y ejecutar wARS → USD₮ según el umbral
- [ ] Alertas de anomalías en ventas
- [ ] Consultas libres en lenguaje natural sobre ventas y saldos
- [ ] Gas del agente en USD₮ (fee abstraction)
- [ ] (Opcional) Canal de WhatsApp y aceptar USA₮ en la página de cobro
- [ ] **Onboarding del primer comercio real**

### Semana 3 - Usuarios, métricas y entrega (lun 3 al dom 8/11)
- [ ] Sumar comercios reales y acompañar su uso diario
- [ ] Dashboard o reporte de métricas: comercios activos, ventas, wARS movidos, USD₮ dolarizados
- [ ] Hardening: manejo de errores, límites y seguridad de claves
- [ ] README del repo: problema, arquitectura, tabla "por qué encaja en cada track", wallets PayTo (vaults), ID ERC-8004, wallet del agente, aclaración de gas sponsoreado y origen de los usuarios
- [ ] Video demo (2 a 3 min): comercio real cobrando, cierre de caja, dolarización y links a Celoscan/8004scan
- [ ] Submission en Loops House en ambos tracks **antes del lun 9/11 06:00**
- [ ] Ganadores: viernes 13/11

---

## 9. Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Los clientes no tienen wallet con wARS | "Pagar con pesos" (on-ramp Ripio) y wallets con passkey |
| Los pagos vía on-ramp de Ripio no llevan nuestro tag | Contarlos como métrica de producto. El agente genera tx propias con tag (alta, apartado, retiro, dolarización) |
| Usuarios independientes difíciles de conseguir | Comercios y clientes reales, y explicar su origen en la entrega |
| WhatsApp Business tarda en aprobarse | MVP en Telegram |
| wARS no paga gas | El agente paga gas en USD₮. Los clientes no pagan gas (x402) |
| Poca liquidez en Textile | Validar en la semana 0. Plan B: USA₮ con x402 |
| Regulación (PSP en Argentina) | Sin custodia (los fondos están en el vault del comercio). Aclararlo en la entrega |

## 10. Decisiones pendientes
- [ ] Tamaño del equipo y roles (contratos / agente / frontend / comercios y pitch)
- [ ] Telegram primero (recomendado) o WhatsApp directo
- [ ] Comercios concretos (nombre y rubro)
- [ ] Track secundario: Textile FX (si hay liquidez) o USA₮ con x402
- [ ] Proveedor de smart wallet para el dueño (Para u otro)
- [ ] LLM del agente

## 11. Futuro (post-hackathon)
- Pago a proveedores desde Tildai (cuentas a pagar).
- Multi-país con wBRL, wMXN y wCOP.
- SDK/widget de cobro x402 para e-commerce.
- Grants de Prezenti y co-marketing con Celo/Ripio.
