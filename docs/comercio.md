# Tildai: guía para el comercio

Esta guía es para vos, que tenés un comercio y querés cobrar con Tildai. No hace falta saber nada de tecnología. Si algo no te queda claro, preguntale al equipo que te acompaña.

Marcas que vas a ver:
- **[PENDIENTE MAINNET]**: todavía no funciona con plata de verdad. Lo estamos terminando.
- **[PRÓXIMA VERSIÓN]**: está hecho, pero todavía no está publicado.

## 1. Qué es Tildai

- Tildai es una caja que atendés desde Telegram.
- Te ayuda a cobrar en pesos digitales, te avisa cada venta y a la noche te hace el cierre de caja.
- Además separa una parte para ahorro y otra para impuestos.

**Lo que Tildai NO hace:**
- **No se queda con tu plata.** La plata entra a una caja propia de tu comercio, a tu nombre. Tildai solo puede mandarla a tu billetera o separarla dentro de tu caja, y con un tope por día.
- **No cobra comisión propia, por ahora.** La caja no descuenta nada. Si usás Ripio para pasar a pesos en el banco, Ripio pone sus propias condiciones.
- **No te pide nunca tu clave ni tus palabras secretas.** Si alguien te las pide en nombre de Tildai, es una estafa.

Palabras que vas a escuchar:
- **Pesos digitales (wARS):** pesos argentinos de Ripio que viven en el celular. Un peso digital vale un peso.
- **Billetera:** una app del celular donde guardás esos pesos. Solo vos la manejás.
- **Dirección:** el "CBU" de tu billetera. Empieza con `0x` y tiene 42 letras y números.
- **Tu caja (vault):** la cuenta de tu comercio donde caen los cobros.

## 2. Antes de empezar: tu billetera

Necesitás una billetera en el celular. Es donde vas a recibir la plata cuando la saques de la caja.

1. Bajá una de estas apps (solo desde la página oficial o la tienda de tu celular):
   - **Valora:** https://valora.xyz (Android y iPhone).
   - **MiniPay:** https://www.opera.com/products/minipay (Android; en iPhone por ahora es una versión de prueba).
2. Abrila y creá tu billetera. Seguí los pasos de la app.
3. **Guardá el respaldo:**
   - MiniPay se respalda con tu cuenta de Google.
   - Valora te da una frase de recuperación: unas palabras secretas para recuperar la billetera si perdés el celular. Anotalas en papel y guardalas bien. No se las pases a nadie, tampoco a Tildai.
4. **Cuál conviene:** con Valora podés hacer que aparezcan los pesos digitales. Se agregan a mano desde "Importar token" ("Import Token"), y el equipo te pasa los datos. En MiniPay no confirmamos que se vean los pesos digitales: antes de elegirla, consultalo con el equipo.

**Por qué tiene que ser una billetera tuya, donde vos firmás** (firmar = aprobar cada pago desde tu app):
- Esa dirección es la dueña de tu caja. Es la única que puede sacar toda la plata.
- **No se puede cambiar después.**
- No uses la dirección para depositar en una app de compraventa (Ripio, Binance, Lemon, etc.). Esa dirección no es tuya: no podrías sacar la plata de la caja.
- No uses la dirección de otra persona ni la de Tildai.

**Cómo copiar tu dirección:**
1. En la app, buscá "Recibir" o tocá tu cuenta.
2. Tocá "Copiar dirección".
3. Fijate que empiece con `0x`. Mirá los primeros y los últimos caracteres para estar seguro.

## 3. Darte de alta

Hoy el alta la hace el equipo junto con vos. [PRÓXIMA VERSIÓN] Va a ser por invitación: solo van a entrar los chats que habilite el equipo.

1. El equipo te pasa el nombre del bot de Tildai en Telegram.
2. Abrilo y escribile. Mejor por privado que en un grupo, así no compartís tus datos con nadie más.
3. [PRÓXIMA VERSIÓN] Si te contesta *"El alta es por invitación y está cerrada para este chat"*, avisale al equipo que ya le escribiste. Ellos habilitan tu chat y te avisan.
4. Escribí `/start`.
5. El bot te pide tu dirección. Pegá la dirección que copiaste (la que empieza con `0x`).
   - Si pegás por error una clave o tus palabras secretas, el bot no la lee y te pide que la borres. Borrala y, por las dudas, creá una billetera nueva.
6. El bot te pide el **tope diario**, y sugiere $100.000.
   - **Qué es:** lo máximo que Tildai puede sacar de tu caja en un día, sumando lo que te manda a tu billetera y lo que pasa a dólares.
   - **No limita cuánto cobrás.** Podés vender $500.000 en un día con tope de $100.000.
   - **Ejemplo:** tu tope es $100.000 y le pedís "pasame $150.000". No lo hace y te avisa. Pedile $100.000 hoy y el resto mañana.
   - Escribilo como lo escribís siempre: "100.000" es cien mil. El máximo es $10.000.000.
7. Tildai crea tu caja y te contesta algo así:
   - *"Tu caja está creada: 0x…"* (la dirección de tu caja).
   - *"Tu QR fijo para cobrar es este link: …"*
   - Tus límites: el tope diario, el precio máximo del dólar (hoy $1.700 por dólar) y lo máximo por cada pase a dólares (hoy $60.000).
   - *"La plata es siempre tuya…"*
8. Si te dice que la caja "se está creando", esperá un rato y escribí `/start` de nuevo. No te va a crear dos cajas.

[PENDIENTE MAINNET] Hoy las cajas se crean solo en la red de prueba. Con plata de verdad, todavía no.

## 4. Cobrar

**El cartel del mostrador:**
1. El equipo te pasa el link de tu cartel, con tu caja y el nombre de tu comercio (para el equipo: la página `/cartel` con tu caja).
2. Abrilo y tocá "Imprimir". Pegá el cartel en el mostrador.
3. El cartel dice: *"Pagá acá con pesos"*, con un QR y tres pasos para el cliente.

**Cobrar un monto justo:** escribile al bot, por ejemplo, *"cobrame 8.500"*. Te devuelve un link con ese monto para mandarle al cliente o mostrarle.

**Cómo paga el cliente** [PENDIENTE MAINNET]:
1. Escanea el QR con la cámara del celular.
2. Pone el monto de la compra (o ya viene puesto, si usaste "cobrame").
3. Elige cómo pagar:
   - **Con su billetera**, si tiene pesos digitales: firma y listo. **El cliente no paga nada extra**: la comisión de la red la cubrimos nosotros.
   - **Con pesos**, desde Ripio: el botón lo lleva a Ripio, que le manda los pesos digitales directo a tu caja.
4. Mientras se confirma, la página dice "confirmando…".

**El aviso:**
- Una venta se marca como cobrada solo cuando el pago está confirmado. Si no se pudo verificar, queda "pendiente", nunca "cobrada".
- Si todavía no te llega el aviso solo, preguntale al bot *"¿me pagaron?"*. Te contesta, por ejemplo, *"✓ Entraron $ 8.500 (venta #3)"*.
- [PRÓXIMA VERSIÓN] Tildai te va a avisar cada venta sin que preguntes: *"Entró una venta: $ 8.500 ✓"*. Si entra plata sin un cobro pedido (por ejemplo, del cartel), te dice *"Te llegó un pago de $ … sin venta asociada"*.

## 5. El cierre de caja de la noche [PRÓXIMA VERSIÓN]

Hoy el cierre automático corre solo para la caja del equipo. El cierre por cada comercio está hecho pero todavía no está publicado. Cuando esté, todos los días a las **21 h** te llega un mensaje con:
- El total del día.
- Cuántas ventas hiciste.
- El ticket promedio (cuánto gastó cada cliente, en promedio).
- La comparación con el mismo día de la semana pasada.

**Después aparta ahorro e impuestos:**
- Separa un porcentaje de lo que vendiste ese día: una parte para ahorro y otra para impuestos.
- **La plata no sale de tu caja.** Queda separada adentro, en dos "sobres".
- Tildai no puede sacar esos sobres. Solo puede pasarlos a dólares si vos le das permiso aparte.
- Si algo falla (por ejemplo, no se pudieron confirmar los pagos del día), no aparta nada y te lo dice.

**Cómo cambiar los porcentajes:** hoy los fija el equipo, y son los mismos para todos los comercios. Si querés otros, pedíselo al equipo. Si no hay porcentajes cargados, Tildai no aparta nada y te lo avisa.

## 6. Sacar la plata

**A tu billetera** [PENDIENTE MAINNET]:
1. Escribile al bot, por ejemplo, *"pasame 50.000"*.
2. Tildai manda esa plata a **tu billetera**, la que pusiste en el alta. No la puede mandar a ningún otro lado.
3. Sale de la plata libre de tu caja, no de los sobres de ahorro e impuestos. Respeta tu tope diario.
4. Te contesta con un link de Ripio para pasar esa plata a pesos.

**A tu cuenta del banco, con Ripio:**
1. Abrí el link de Ripio que te dio Tildai.
2. Seguí los pasos de Ripio. Vas a mandar los pesos digitales desde tu billetera y Ripio te los pasa a pesos en tu cuenta.
3. **Para mandar desde tu billetera necesitás tener un poquito de dólares digitales (USD₮ o USDC) para pagar la comisión de la red: los pesos digitales no sirven para eso.** Son unos centavos y tu billetera te la muestra antes de confirmar. Pedile al equipo que te ayude a cargarlo la primera vez.
4. Las condiciones del cambio las pone Ripio.

**Siempre podés sacar todo:**
- La caja está hecha para que **tu billetera** pueda sacar toda la plata en cualquier momento, sobres incluidos, aunque Tildai esté apagado o pausado.
- También podés pausar a Tildai o cambiar tus límites.
- Ojo: hoy esas operaciones no tienen un botón en Tildai. Si las necesitás, el equipo te acompaña a hacerlas desde tu billetera.

## 7. Preguntas frecuentes

**¿Qué pasa si se corta internet?**
- El cliente necesita internet en su celular para pagar.
- Los pagos que entraron quedan en tu caja aunque vos estés sin internet. Cuando vuelvas, preguntale al bot *"¿me pagaron?"*.
- Si Tildai no puede verificar un pago, lo deja como "pendiente". Nunca te lo da por cobrado sin confirmar.

**El cliente dice que pagó y no me llegó el aviso. ¿Qué hago?**
1. Preguntale al bot *"¿me pagaron?"*.
2. [PRÓXIMA VERSIÓN] Pedile al cliente el número de operación que le muestra su billetera y pasáselo al equipo. Te abren el comprobante, que dice si el pago a una caja de Tildai está "confirmado en la red" o "esperando confirmación" (para el equipo: la página `/comprobante` con el número de operación).
3. [PRÓXIMA VERSIÓN] Pedile al equipo el link de tu panel del día (para el equipo: la página `/panel` con tu caja). Ahí ves lo cobrado hoy y cada cobro con su hora.
4. Si el pago no aparece en ningún lado, no entregues la mercadería hasta que aparezca.

**¿Y si pierdo el celular?**
- **Lo que importa es tu billetera.** Para recuperarla necesitás el respaldo:
  - En MiniPay, tu cuenta de Google.
  - En Valora, tu frase de recuperación.
- Cuidá el respaldo como la llave del local: la frase anotada en papel, en un lugar seguro, y si podés otra copia en otro lugar. **Nunca se la pases a nadie: ni a Tildai, ni al equipo, ni a alguien que diga ser soporte. Nadie te la va a pedir.**
- **Si perdés el celular y no tenés el respaldo, la plata de tu caja queda trabada: no la puede sacar nadie, ni vos, ni nosotros.** Los retiros de la caja van siempre a esa billetera.
- Mientras no la recuperes, **no le pidas a Tildai que te pase plata**: la mandaría a una billetera que ya no controlás.
- Con el respaldo, instalás la app en otro celular, recuperás la billetera y seguís como antes. La plata de tu caja sigue ahí, y Tildai puede seguir cobrando y avisándote en Telegram si recuperás tu cuenta.

**¿Tildai puede sacarme la plata?**
No. Solo puede mandarla a tu billetera, separarla dentro de tu caja o pasarla a dólares con los límites que viste en el alta. Todo con tope diario.

**¿Cuánto me cobra Tildai?**
Hoy, nada. La caja no descuenta comisión.

## Fuentes

Del código de Tildai:
- Alta y permisos del chat: `agent/channels/telegram.ts`, `agent/src/alta.ts` y `agent/tools/crear_vault.ts` (rama `Antony27c/devin-agent`): alta por invitación, tope sugerido $100.000 y máximo $10.000.000, precio máximo 1.700 y $60.000 por pase a dólares.
- Caja: `contracts/src/TildaiVault.sol` (sin comisión, destinos permitidos, tope diario, sobres de ahorro e impuestos y retiro total del dueño).
- Cobro, aviso y cierre: `agent/src/sales.ts`, `agent/src/cierreApartado.ts`, `agent/schedules/cierre_caja.ts` (porcentajes por `TILDAI_SAVINGS_PCT` y `TILDAI_TAXES_PCT`) y `agent/src/avisos.ts` (rama `Antony27c/devin-agent`).
- Retiro y link de Ripio: `agent/tools/retirar.ts` y `agent/src/fondos.ts`.
- Página de cobro y cartel: `web/app/page.tsx`, `web/app/cartel/page.tsx` y `web/lib/x402.ts` (el cobro con billetera solo funciona en mainnet).
- Comprobante y panel: `web/app/comprobante/page.tsx` (rama `Antony27c/devin-web`) y `web/app/panel/page.tsx` (rama `Antony27c/devin-frontend`).

Páginas oficiales:
- MiniPay: https://www.opera.com/products/minipay (billetera propia, "Backed up automatically… with your Google account", Android y TestFlight en iPhone).
- Valora: https://valora.xyz
- Valora, importar un token: https://support.valoraapp.com/hc/en-us/articles/27327093378829-How-to-Import-a-Token
- Ripio Ramp (pasar de pesos a pesos digitales y al revés): https://ramp.ripio.com
