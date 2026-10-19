# Integración de Textile FX para Dolarización de wARS a USD₮

Este documento detalla la viabilidad, arquitectura, contratos, costos y liquidez de **Textile FX** para automatizar la dolarización de excedentes en **Tildai** sobre **Celo mainnet**.

---

## 1. Conclusión rápida: ¿Sirve y hay liquidez?

- **¿Sirve Textile FX para dolarizar wARS a USD₮?**: **SÍ a nivel de cotización, pero con reservas operativas**. Textile FX cuenta con el corredor `wARS ↔ USDT` configurado en Celo mainnet (Chain ID `42220`).
- **¿Hay liquidez actual wARS/USD₮ para dolarizar?**:
  - **Cotización y profundidad declarada:** **SÍ HAY**.
    - Endpoint RFQ Preview ([`https://api.textilecredit.com/v2/rfq/preview`](https://api.textilecredit.com/v2/rfq/preview)): responde con cotización válida (`status: "preview"`).
    - **Profundidad declarada para compra de USD₮ (`availableBuyAmount`):** **~94.912 USD₮** (~$94.900 USD).
    - **Profundidad declarada para venta de wARS (`availableSellAmount`):** **~153.489.433 wARS** (~$153,4 millones de wARS).
    - **Tasa spot/ask:** **~1.617,33 wARS por 1 USD₮**.
  - **Operaciones reales e historial:** **CASI NULO**.
    - El feed público de tickers ([`https://api.textilecredit.com/tickers`](https://api.textilecredit.com/tickers)) reporta para el par `USDT_WARS`:
      - **Volumen de 24 horas:** de tan solo **6,39 USD₮** (apenas 10.328,78 wARS).
      - **Bid:** `0` (no hay posturas de compra de USDT pagando wARS).
      - **Ask:** `1617,33` wARS por USD₮.
  - **Conclusiones clave:**
    1. **Cotiza, pero hay que probar con un monto chico en mainnet:** Aunque los market makers declaran profundidad en la API, casi no hay operaciones reales ni historial de llenados en el corredor. Es indispensable validar una ejecución real con poco capital antes de confiarle excedentes comerciales.
    2. **Corredor unidireccional (bid 0):** Con bid en `0`, volver de USD₮ a wARS no tiene comprador en Textile. Solo sirve para dolarizar (wARS → USD₮), no para desdolarizar.

---

## 2. Direcciones reales de contratos en Celo Mainnet (Chain `42220`)

Todas las direcciones fueron verificadas contra la documentación oficial de Textile FX en su [Address Book](https://docs.textilecredit.com/protocol/address-book.html) y confirmadas onchain en Celo mainnet (código bytecode activo comprobado vía RPC `https://forno.celo.org` y Celoscan):

| Concepto | Contrato | Dirección en Celo Mainnet (`42220`) | Decimales | Fuente / Celoscan |
|---|---|---|---|---|
| **Token Entrada** | **wARS** (Ripio Wrapped ARS) | `0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D` | 18 | [Celoscan Token](https://celoscan.io/token/0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D) |
| **Token Salida** | **USD₮** (Tether en Celo) | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 | [Celoscan Token](https://celoscan.io/token/0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e) |
| **Liquidación Onchain** | **LimitOrderReactor** (UniswapX) | `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3` | - | [Celoscan Contract](https://celoscan.io/address/0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3) |
| **Controlador de Fee** | **SellFirstFeeController** | `0x7b005466F905DD882A959888154587fA76cd3Ea7` | - | [Celoscan Contract](https://celoscan.io/address/0x7b005466F905DD882A959888154587fA76cd3Ea7) |
| **Permisos de Transferencia**| **Permit2** (Uniswap Canónico) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | - | [Celoscan Contract](https://celoscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |

---

## 3. Costos y Fees

1. **Protocol Taker Fee:**
   - **1 bps (0,01%)** sobre el volumen operado en mainnet (frente a 5 bps en testnets).
   - Gobernado onchain por el contrato `SellFirstFeeController` (`0x7b005466F905DD882A959888154587fA76cd3Ea7`).
   - El fee se descuenta automáticamente del monto a convertir (para 50.000 wARS, el fee del protocolo es de **4,9995 wARS**).
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
           │ 2. POST /v2/rfq/request       │ [NO VERIFICADO EN PROD]
           ├ - - - - - - - - - - - - - - -►│
           │◄ - - - - - - - - - - - - - - -┤ Calldata firmado (LimitOrderReactor + Permit2)
           │                               │
           │ 3. Enviar tx onchain a Celo   ▼
           └─────────────────────────► TildaiVault / LimitOrderReactor
```

### Fase A: Cotización indicativa (`POST /v2/rfq/preview`) - VERIFICADA
- **Propósito:** Descubrimiento de precio en tiempo real sin bloquear inventario ni requerir firmas ni claves.
- **Sin custodia ni autenticación:** Endpoint público que no requiere API key ni firma de wallet.
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
  - `availableSellAmount` / `availableBuyAmount`: Profundidad reportada por los market makers.

### Fase B: Cotización en firme y ejecución (`POST /v2/rfq/request`) - NO VERIFICADA

> [!WARNING] Estado: No verificado en producción
> Los detalles a continuación sobre `POST /v2/rfq/request` y `takerProof` provienen de especificaciones preliminares de la API RFQ de Textile ([documentación preliminar de endpoints](https://docs.textilecredit.com/rfq/endpoints)), pero **NO fueron verificados con swaps reales en Celo mainnet**. Antes de implementar la ejecución final en Tildai, debe validarse directamente en mainnet o coordinar con el equipo de Textile si se requiere partner API key.

- **Flujo preliminar según docs:**
  - Solicita orden vinculante firmada por los Market Makers (fillers) con respuesta en ~750 ms y TTL de ~60 segundos.
  - Ejecución All-or-Nothing (sin fills parciales).
  - Requiere un identificador del taker y, en llamadas sin API key de partner, un objeto `takerProof` (firma EIP-712 sobre `Textile Taker Control`) para acreditar control de la wallet y evitar spam.
  - Devuelve `transactions.approval` (Permit2 si falta allowance) y `transactions.swap` lista para enviar al `LimitOrderReactor`.

---

## 5. Módulo de Integración `fx/`

En la carpeta `fx/` del repositorio se implementó el cliente en TypeScript (Node 24, viem) para consultar cotizaciones indicativas a Textile FX con manejo de timeout (`AbortSignal.timeout` de 8 segundos por defecto, configurable vía `options.timeoutMs`):

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
//   feeAmountFormatted: '4.9995',    // 1 bps de fee
//   availableBuyAmount: 94912472527n
// }
```

### Ejecución de tests:
```bash
cd fx && node --test
```
Todos los tests corren con respuestas mockeadas (sin claves ni transacciones reales) e incluyen pruebas de timeout con fetches que no responden.

---

## 6. Flujo de Dolarización en el Agente Tildai

Para cumplir con las reglas de negocio del proyecto (sección 8 de `idea.md`):

1. **Evaluación de umbral:** Al cierre de caja (cron 21:00 hs) o a pedido del comercio, el agente calcula el saldo disponible del vault. Si el excedente supera el umbral fijado por el dueño (ej. > 20.000 wARS), inicia el proceso de dolarización.
2. **Paso 1 - Cotizar:** El agente llama a `cotizar(excedente)`. Si la respuesta es `no_quote` o la API no responde dentro del timeout, el agente **no mueve fondos** y avisa la anomalía por Telegram.
3. **Paso 2 - Firmar y ejecutar:** Si la tasa es aceptable (ver pendientes de diseño), el agente solicita la orden firme a `/v2/rfq/request` y ejecuta la transacción sobre Celo llamando a `LimitOrderReactor`.
4. **Attribution Tag obligatorio:** La transacción se envía desde el cliente viem del agente incluyendo el **ERC-8021 Attribution Tag** de la hackathon.
5. **Notificación:** El agente envía el reporte por Telegram: *"✓ Dolarizamos $50.000 wARS a 30,91 USD₮ (tasa: $1.617,33) vía Textile FX"*.

---

## 7. Pendientes de diseño

Antes de codificar la ejecución de swaps en la semana 2, quedan dos decisiones arquitectónicas abiertas:

1. **¿Quién firma el swap si los fondos están en el `TildaiVault`?**
   - El vault es un smart contract, no una EOA con clave privada.
   - El reactor de UniswapX y Permit2 típicamente esperan una firma EIP-712 (`PermitWitnessTransferFrom` o similar) del dueño de los tokens que se van a debitar.
   - Si los fondos están dentro del `TildaiVault`, para firmar el swap se requeriría:
     - **Opción A (EIP-1271):** Que Permit2 y el `LimitOrderReactor` acepten firmas de smart contracts vía `isValidSignature` (EIP-1271), implementado en el contrato `TildaiVault`.
     - **Opción B (Transferencia previa al agente):** Que el vault autorice al agente a retirar el excedente a dolarizar (respetando estrictamente el tope diario del vault), el agente firme y liquide el swap desde su propia wallet EOA, y devuelva inmediatamente los USD₮ resultantes al vault.
     - **Opción C (Swap router propio en el vault):** Que el vault tenga una función `executeSwap` que apruebe directamente al reactor o facilitador sin pasar por Permit2 offchain signatures.
2. **¿Qué tasa mínima (slippage tolerance / tasa piso) se acepta?**
   - Entre la cotización `preview` y la confirmación del bloque en Celo, el precio o el spread de los makers puede variar.
   - Es necesario definir una regla determinística para la tasa mínima: por ejemplo, rechazar cualquier ejecución si la tasa efectiva resulta peor que un **1% de slippage** respecto al preview, o comparar contra un oráculo de referencia (ej. CoinGecko wARS) para proteger al comercio de cotizaciones anómalas.
