# Tildai

Agente de caja para comercios de barrio: cobra en wARS, aparta plata y dolariza el excedente dentro de límites que fija el dueño.

## Personas

**Dueño**:
La persona que tiene el comercio y controla su vault. Puede sacar toda la plata en cualquier momento.
_Avoid_: comerciante, usuario, owner (en textos al usuario)

**Cliente**:
Quien le paga al comercio una compra.
_Avoid_: comprador, pagador

**Agente**:
Tildai actuando con su propia wallet. Opera la caja dentro de los límites del vault y nunca es dueño de la plata.
_Avoid_: bot, operador

## Plata

**Vault**:
La caja fuerte onchain de un comercio, donde entran los cobros. Hay uno por comercio.
_Avoid_: billetera, cuenta, caja

**Operativo**:
La parte del vault que el agente puede retirar al dueño o dolarizar.
_Avoid_: disponible, saldo libre

**Ahorro**:
La parte del vault que el agente apartó para ahorrar. Solo la toca el dueño, salvo que dé permiso para dolarizarla.
_Avoid_: alcancía (en código), reserva

**Impuestos**:
La parte del vault apartada para pagar impuestos. Solo la toca el dueño, salvo que dé permiso para dolarizarla.
_Avoid_: reserva fiscal

**Apartar**:
Pasar plata de operativo a ahorro o a impuestos. La plata no sale del vault.
_Avoid_: separar, mover, asignar

**Retiro**:
Plata que sale del vault hacia la wallet de retiro del dueño.
_Avoid_: transferencia, extracción

**Wallet de retiro**:
La única dirección, elegida por el dueño, a la que el agente puede mandar plata.
_Avoid_: cuenta destino, payout

**Dolarizar**:
Cambiar wARS por USD₮ en Textile FX. Los USD₮ quedan en el vault.
_Avoid_: convertir, swapear (en textos al usuario)

**Permiso para dolarizar apartados**:
Permiso opcional que el dueño le da al agente para dolarizar el ahorro, los impuestos o los dos, después de aceptar un aviso de riesgo. Cada apartado se habilita por separado.

## Límites

**Tope diario**:
Lo máximo que el agente puede retirar más dolarizar en un día argentino. Lo elige cada dueño.
_Avoid_: límite, cupo

**Precio máximo del dólar**:
Los wARS que se pagan como máximo por un USD₮. Si la cotización es peor, no se dolariza.
_Avoid_: tasa piso, slippage (en textos al usuario)

## Ventas

**Venta**:
Un cobro que el agente espera, con monto y momento de creación.
_Avoid_: orden, pedido

**Cobrada**:
Una venta con su pago confirmado onchain. Hasta entonces está pendiente.
_Avoid_: pagada, acreditada

**Cierre de caja**:
El resumen diario de ventas que el agente hace a las 21 h, seguido de los apartados.
_Avoid_: reporte, resumen
