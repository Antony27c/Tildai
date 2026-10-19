# El vault dolariza directo con Textile, sin firmar órdenes

`idea.md` suponía que el vault tenía que firmar la orden de Textile con EIP-1271. La documentación de Textile (`docs.textilecredit.com/api/v2/aggregators`) dice otra cosa: el lado del taker se cobra con un `transferFrom` común a `msg.sender`, sin Permit2 ni callbacks y sin chequear `tx.origin`. Por eso el vault es el taker: el agente le pasa la calldata de `transactions.swap` y el vault hace cuatro cosas:
1. Verifica que `to` y `spender` sean direcciones de Textile permitidas.
2. Aprueba exactamente lo que se va a pagar.
3. Ejecuta el swap y vuelve la aprobación a 0.
4. Revisa los saldos antes y después contra el tope diario y el precio máximo del dólar.

Para la prueba de control de la cotización en firme se usa una API key de partner de Textile. Si no la conseguimos, el plan B es EIP-1271 en el vault, con la regla de no dejar nunca aprobaciones abiertas, porque Permit2 aceptaría esas firmas.

## Considered Options
- **EIP-1271 para firmar la orden**: innecesario, porque el taker no firma la orden, y abre la puerta a que otros protocolos acepten las firmas del agente como si fueran del vault.
- **Pasar la plata a la wallet del agente para que haga el swap**: descartado. Rompe la regla de que el agente no custodia fondos.
