# Integración de Textile FX para Dolarización de wARS a USD₮

Este documento detalla la viabilidad, arquitectura, contratos, costos y liquidez de **Textile FX** para automatizar la dolarización de excedentes en **Tildai** sobre **Celo mainnet**.

---

## 1. Conclusión rápida: ¿Sirve y hay liquidez?

- **¿Sirve Textile FX para dolarizar wARS a USD₮?**: **SÍ**. Textile FX cuenta con el corredor nativo `wARS ↔ USDT` desplegado y activo en Celo mainnet (Chain ID `42220`).
- **¿Hay liquidez actual wARS/USD₮ para dolarizar?**: **SÍ**. Verificado el 18/10/2026 contra los endpoints oficiales de Textile FX:
  - **Profundidad disponible para compra de USD₮ (`availableBuyAmount`):** **~94.912 USD₮** (equivalente a ~$94.900 USD).
  - **Profundidad disponible para venta de wARS (`availableSellAmount`):** **~153.489.433 wARS** (~$153,4 millones de pesos argentinos onchain).
  - **Tasa de cambio spot/ask observada:** **~1.617,33 wARS por 1 USD₮**.
  - **Volumen base reportado (24h):** Activo en el ticker `USDT_WARS`.
  - **Fuentes oficiales:**
    - Feed público de tickers: [`https://api.textilecredit.com/tickers`](https://api.textilecredit.com/tickers)
    - Endpoint RFQ Preview: [`https://api.textilecredit.com/v2/rfq/preview`](https://api.textilecredit.com/v2/rfq/preview)

---

## 2. Direcciones reales de contratos en Celo Mainnet (Chain `42220`)

Todas las direcciones fueron verificadas contra la documentación oficial de Textile FX ([Address Book](https://docs.textilecredit.com/developers/address-book)), y comprobadas onchain en Celo mainnet (código bytecode activo verificado vía RPC `https://forno.celo.org` y Celoscan):

| Concepto | Contrato | Dirección en Celo Mainnet (`42220`) | Decimales | Fuente / Celoscan |
|---|---|---|---|---|
| **Token Entrada** | **wARS** (Ripio Wrapped ARS) | `0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D` | 18 | [Celoscan Token](https://celoscan.io/token/0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D) |
| **Token Salida** | **USD₮** (Tether en Celo) | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 | [Celoscan Token](https://celoscan.io/token/0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e) |
| **Liquidación Onchain** | **LimitOrderReactor** (UniswapX) | `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3` | - | [Celoscan Contract](https://celoscan.io/address/0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3) |
| **Controlador de Fee** | **SellFirstFeeController** | `0x7b005466F905DD882A959888154587fA76cd3Ea7` | - | [Celoscan Contract](https://celoscan.io/address/0x7b005466F905DD882A959888154587fA76cd3Ea7) |
| **Permisos de Transferencia**| **Permit2** (Uniswap Canónico) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | - | [Celoscan Contract](https://celoscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |

> [!IMPORTANT]
> **No inventar direcciones:** Todas estas direcciones son canónicas y corresponden a las deployments oficiales de Textile FX y Celo.

---

## 3. Costos y Fees

1. **Protocol Taker Fee:**
   - **1 bps (0,01%)** sobre el volumen operado en mainnet (frente a 5 bps en testnets).
   - Gobernado onchain por el contrato `SellFirstFeeController` (`0x7b005466F905DD882A959888154587fA76cd3Ea7`).
   - El fee se descuenta automáticamente y viene integrado en el tipo de cambio efectivo del quote (`feeAmount` en unidades atómicas).
2. **Costo de gas:**
   - La liquidación onchain interactúa con el `LimitOrderReactor` a través de Permit2.
   - En Celo mainnet, el costo de gas de esta transacción suele ser inferior a **$0,005 USD**.
   - Como wARS no es fee currency, el agente Tildai paga el gas en USD₮/USDC usando fee abstraction (dirección del adapter en `feeCurrency`).

---

## 4. Cómo funciona la cotización y liquidación (RFQ)

Textile FX opera con un modelo híbrido: **RFQ off-chain con liquidación atómica on-chain**.

```
  ┌─────────────────┐           ┌──────────────────────┐
  │  Agente Tildai  │           │   Textile FX API     │
  └────────┬────────┘           └──────────┬───────────┘
           │                               │
           │ 1. POST /v2/rfq/preview       │ (Indicativo, sin firma ni claves)
           ├──────────────────────────────►│
           │◄──────────────────────────────┤ Devuelve tasa, USD₮ estimado y fee (1 bps)
           │                               │
           │ 2. POST /v2/rfq/request       │ (Firma compromiso con Market Makers)
           ├──────────────────────────────►│
           │◄──────────────────────────────┤ Calldata firmado (LimitOrderReactor + Permit2)
           │                               │
           │ 3. Enviar tx onchain a Celo   ▼
           └─────────────────────────► TildaiVault / LimitOrderReactor
```

### Fase A: Cotización indicativa (`POST /v2/rfq/preview`)
- **Propósito:** Descubrimiento de precio en tiempo real sin bloquear inventario de market makers ni requerir firmas ni claves.
- **Sin custodia ni autenticación:** No requiere API key ni firma de wallet (`takerProof`).
- **Parámetros:**
  - `chainId`: `42220` (Celo).
  - `sellToken`: `0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D` (wARS).
  - `buyToken`: `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (USDT).
  - `sellAmount`: Monto exacto en unidades atómicas (18 decimales).
- **Respuesta:**
  - `status`: `"preview"` o `"no_quote"` (si el monto excede la liquidez disponible).
  - `sellAmount`: Monto vendido.
  - `buyAmount`: Monto en USD₮ a recibir (6 decimales).
  - `feeAmount`: Fee del protocolo en unidades atómicas (1 bps).
  - `rateRay`: Tasa de cambio normalizada a RAY (`1e27`).
  - `availableSellAmount` / `availableBuyAmount`: Profundidad total del libro.

### Fase B: Cotización en firme y ejecución (`POST /v2/rfq/request`)
- **Propósito:** Solicitar orden vinculante firmada por los Market Makers (fillers) para ejecutar el swap.
- **All-or-Nothing:** Llena el monto completo solicitado o devuelve `no_quote` (no hay fills parciales). Si hace falta, agrupa varios makers mediante `executeBatch`.
- **Ventana de tiempo:** Presupuesto de respuesta de makers ~750 ms, con TTL de la orden típicamente limitado a 60 segundos.
- **Autenticación del Taker:**
  - Con API Key de partner: Header `Authorization: Bearer <key>`.
  - Sin API Key: Requiere objeto `takerProof` firmado por la wallet (EIP-712 con dominio `Textile Taker Control`, versión `1`, tipo `TakerControl`).
- **Respuesta de ejecución:**
  - `transactions.approval`: Aprobación ERC-20 hacia Permit2 si la allowance actual es insuficiente.
  - `transactions.swap`: Transacción lista para enviar al contrato `LimitOrderReactor` (`to`, `data`, `value`).

---

## 5. Módulo de Integración `fx/`

En la carpeta `fx/` del repositorio se implementó el cliente en TypeScript (Node 24, viem) para consultar cotizaciones a Textile FX:

- **Archivo principal:** [`fx/index.ts`](../fx/index.ts)
- **Suite de tests:** [`fx/index.test.ts`](../fx/index.test.ts)

### Interfaz del módulo:
```typescript
import { cotizar } from './fx/index.ts';

// Cotizar 50.000 wARS de excedente:
const cotizacion = await cotizar('50000');

console.log(cotizacion);
// {
//   status: 'preview',
//   sellAmountFormatted: '50000',
//   buyAmountFormatted: '30.915150', // USD₮
//   effectiveRate: 1617.33,          // ARS por USD₮
//   feeAmountFormatted: '5.0',       // 1 bps de fee
//   availableBuyAmount: 94912472527n
// }
```

### Ejecución de tests:
```bash
cd fx && node --test
```
Todos los tests corren con respuestas mockeadas (sin claves ni transacciones reales) y ejecutan en verde utilizando el test runner nativo de Node 24.

---

## 6. Flujo de Dolarización en el Agente Tildai

Para cumplir con las reglas de negocio del proyecto (sección 8 de `idea.md`):

1. **Evaluación de umbral:** Al cierre de caja (cron 21:00 hs) o a pedido del comercio, el agente calcula el saldo disponible del vault. Si el excedente supera el umbral fijado por el dueño (ej. > 20.000 wARS), inicia el proceso de dolarización.
2. **Paso 1 - Cotizar:** El agente llama a `cotizar(excedente)`. Si la respuesta es `no_quote` o la API no responde, el agente **no mueve fondos** y avisa la anomalía por Telegram.
3. **Paso 2 - Firmar y ejecutar:** Si la tasa es aceptable, el agente solicita la orden firme a `/v2/rfq/request` y ejecuta la transacción sobre Celo llamando a `LimitOrderReactor`.
4. **Attribution Tag obligatorio:** La transacción se envía desde el cliente viem del agente incluyendo el **ERC-8021 Attribution Tag** de la hackathon.
5. **Notificación:** El agente envía el reporte por Telegram: *"✓ Dolarizamos $50.000 wARS a 30,91 USD₮ (tasa: $1.617,33) vía Textile FX"*.
