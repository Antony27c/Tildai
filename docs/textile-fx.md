# Integración de Textile FX para Dolarización de wARS a USD₮

Este documento detalla la viabilidad, arquitectura, contratos, costos y liquidez de **Textile FX** para automatizar la dolarización de excedentes en **Tildai** sobre **Celo mainnet**.

---

## 1. Conclusión rápida: ¿Sirve y hay liquidez?

- **¿Sirve Textile FX para dolarizar wARS a USD₮?**: **SÍ**. Textile FX cuenta con el corredor `wARS ↔ USDT` configurado en Celo mainnet (Chain ID `42220`).
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
| **Spender / Reactor 1** | **LimitOrderReactor** (UniswapX) | `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3` | - | [Celoscan Contract](https://celoscan.io/address/0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3) |
| **Spender / Target 2** | **VaultOrderExecutor** | `0x01b006d5c687bde182aa36F542f1f014144742e2` | - | [Celoscan Contract](https://celoscan.io/address/0x01b006d5c687bde182aa36F542f1f014144742e2) |
| **Controlador de Fee** | **SellFirstFeeController** | `0x7b005466F905DD882A959888154587fA76cd3Ea7` | - | [Celoscan Contract](https://celoscan.io/address/0x7b005466F905DD882A959888154587fA76cd3Ea7) |
| **Permisos de Transferencia**| **Permit2** (Uniswap Canónico) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | - | [Celoscan Contract](https://celoscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |

---

## 3. Costos y Fees

1. **Protocol Taker Fee:**
   - **1 bps (0,01%)** sobre el volumen operado en mainnet (frente a 5 bps en testnets).
   - Gobernado onchain por el contrato `SellFirstFeeController` (`0x7b005466F905DD882A959888154587fA76cd3Ea7`).
   - El fee se descuenta automáticamente del monto a convertir (para 50.000 wARS, el fee del protocolo es de **4,9995 wARS**).
2. **Costo de gas:**
   - La liquidación onchain interactúa con el `LimitOrderReactor` o `VaultOrderExecutor` a través del vault.
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
           │ 2. POST /v2/rfq/request       │ (Bearer TEXTILE_API_KEY, taker = vault)
           ├──────────────────────────────►│
           │◄──────────────────────────────┤ data = { rfqId, claimToken, status: 'quoted', quote, transactions }
           │                               │
           │ 3. vault.swap(opId, ...)      ▼
           └─────────────────────────► TildaiVault ──transferFrom──► Textile (LimitOrderReactor)
```

### Fase A: Cotización indicativa (`POST /v2/rfq/preview`)
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

### Fase B: Cotización en firme y ejecución (`POST /v2/rfq/request`)
- **Decisión arquitectónica (ADR 0001):**
  - El vault es el **taker** de la orden y no requiere EIP-1271.
  - Al utilizar una **API key de partner** (`TEXTILE_API_KEY`), la API no requiere ni verifica `takerProof`.
  - El lado del taker se liquida mediante un `transferFrom` estándar ejecutado durante la llamada atómica a `TildaiVault.swap`.
- **Estructura oficial de respuesta según documentación (`docs.textilecredit.com/api/v2/rfq`):**
  ```typescript
  const { rfqId, claimToken, status, quote, transactions } = response.data;
  // quote: { sellAmount, buyAmount, feeAmount, takerPays, rateRay, expiresAt, orderDeadline, reactor, spender }
  // transactions: { approval: { to: warsAddress }, swap: { to: reactorAddress, data } }
  ```
- **Parámetros de la llamada:**
  - `Authorization: Bearer <TEXTILE_API_KEY>` (leída de entorno, nunca expuesta en logs ni mensajes de error).
  - `taker`: Dirección del contrato `TildaiVault`.
  - `sellAmount`: Monto en unidades atómicas de wARS (18 decimales).
  - `timeout`: 75 segundos según especificación de Textile.

---

## 5. Módulo de Integración `fx/`

En la carpeta `fx/` del repositorio se implementaron las funciones para cotizar y preparar el swap:

- **Archivo principal:** [`fx/index.ts`](../fx/index.ts)
- **Suite de tests:** [`fx/index.test.ts`](../fx/index.test.ts)

### 1. Cotización indicativa (`cotizar`)
```typescript
import { cotizar } from './fx/index.ts';

const preview = await cotizar('50000');
console.log(preview);
// { status: 'preview', sellAmountFormatted: '50000', buyAmountFormatted: '30.915150', effectiveRate: 1617.33, feeAmountFormatted: '4.9995' }
```

### 2. Cotización firme y argumentos de swap (`cotizarFirme`)
Pide una orden vinculante a los market makers y valida rigurosamente las condiciones de seguridad antes de devolver los argumentos para `TildaiVault.swap`:

```typescript
import { parseUnits } from 'viem';
import { cotizarFirme } from './fx/index.ts';

const swapArgs = await cotizarFirme({
  monto: '50000',
  vaultAddress: '0xVault...',
  maxRate: parseUnits('1700', 18),      // Max wARS (wei) pagados por 1 USD₮ entero (unidad del vault)
  previewRate: parseUnits('1617.33', 18) // Tasa preview obligatoria para control de slippage <= 1%
});

console.log(swapArgs);
// {
//   rfqId: 'rfq_01j...',
//   claimToken: 'clm_01j...',
//   spender: '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3',
//   target: '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3',
//   data: '0x1234...',
//   amountIn: 50000000000000000000000n, // takerPays en wei
//   minOut: 30915150n,                  // buyAmount en unidades de USDT (6 dec)
//   expiresAt: 1756400060               // timestamp en segundos
// }
```

### Reglas de validación y causas de rechazo:
La función `cotizarFirme` rechaza la orden y arroja un error descriptivo si:
1. `TEXTILE_API_KEY` no está configurada en el entorno (o en opciones).
2. La API responde `status: "no_quote"` (devuelve el motivo reportado, sin inventar tasas por defecto).
3. `status` no es `'quoted'`.
4. Ocurre un error HTTP o de red (la API key nunca se filtra en el mensaje de error; se utiliza `status` y `error.code` sin volcar cuerpos crudos).
5. `expiresAt` ya pasó o vence en menos de 15 segundos.
6. `quote.spender` no es una dirección autorizada en Celo (`0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3` ni `0x01b006d5c687bde182aa36F542f1f014144742e2`).
7. `transactions.swap.to` (target) no es una dirección autorizada en Celo.
8. `quote.takerPays` supera el monto pedido (`takerPays > sellAmountAtomic`).
9. La tasa en enteros supera `maxRate` (`takerPays * 10^6 > buyAmount * maxRate`).
10. La tasa en enteros es más de 1% peor que la cotización previa (`firmRateWei * 100 > previewRateWei * 101`).
11. La solicitud excede el timeout de 75 segundos.

### Ejecución de tests:
```bash
cd fx && node --test
```
Todos los tests corren con respuestas mockeadas (sin bloquear liquidez real de los makers) y validan el caso feliz y cada causa de rechazo.

---

## 6. Flujo de Dolarización en el Agente Tildai

Para cumplir con las reglas de negocio del proyecto:

1. **Evaluación de umbral:** Al cierre de caja (cron 21:00 hs) o a pedido del comercio, el agente calcula el saldo operativo disponible del vault. Si el excedente supera el umbral fijado por el dueño (ej. > 20.000 wARS), inicia el proceso de dolarización.
2. **Paso 1 - Preview:** El agente llama a `cotizar(excedente)`. Si la respuesta es `no_quote` o la API no responde, el agente **no mueve fondos** y avisa por Telegram.
3. **Paso 2 - Cotización firme:** Si la tasa es aceptable, el agente llama a `cotizarFirme(...)` pasando la dirección del vault, `maxRate` y `previewRate`.
4. **Paso 3 - Ejecución onchain:** Con los argumentos recibidos (`spender`, `target`, `data`, `amountIn`, `minOut`), el agente genera un `opId` único y envía la transacción a `TildaiVault.swap(...)` en Celo mainnet, incluyendo el attribution tag ERC-8021.
5. **Notificación:** El agente envía el reporte por Telegram: *"✓ Dolarizamos $50.000 wARS a 30,91 USD₮ (tasa: $1.617,33) vía Textile FX"*.

---

## 7. Decisiones de diseño resueltas (ADR 0001)

1. **Custodia y firma del swap:**
   - **Resuelto vía ADR 0001:** El vault es el taker directo. El contrato `TildaiVault` aprueba a `spender` por el monto exacto `amountIn`, llama a `target` con `data`, y devuelve la aprobación a cero. No se requiere firma EIP-1271 ni transferir fondos a la wallet del agente.
   - La prueba de control de la orden queda cubierta por la **API key de partner** de Textile.
2. **Protección contra slippage y manipulación:**
   - **Doble barrera de protección con aritmética entera:**
     - **Onchain:** `TildaiVault.swap` verifica `spent * usdtUnit <= received * maxRate`.
     - **Offchain:** `cotizarFirme` rechaza cualquier cotización firme que sea más de **1% peor** que la cotización previa `previewRate` o que supere `maxRate`.
