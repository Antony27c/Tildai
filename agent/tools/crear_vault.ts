import { defineTool } from "eve/tools";
import { z } from "zod";

import { MAX_TOPE_PESOS, parsePesosTexto, pesosToWei } from "../src/money.ts";
import { chatIdDe, creadorVault } from "../src/runtime.ts";
import { looksLikeSecret } from "../src/secrets.ts";

export default defineTool({
  description:
    "Da de alta al comercio: crea su vault en la factory (una sola vez por chat). ANTES de llamarla explicale al dueño que la wallet que pasa es la única que puede sacar la plata: tiene que ser una donde ÉL firme (MiniPay o Valora), nunca una dirección de depósito de un exchange, y pedile que lo confirme. Llamala solo con la wallet (0x de 42 caracteres), el tope diario que eligió y confirmado=true. Devuelve la dirección del vault, el link de cobro del QR fijo y los límites: pasáselos al dueño tal cual.",
  inputSchema: z.object({
    walletDelDuenio: z.string().describe("Dirección 0x que pegó el dueño (nunca una clave privada ni una frase semilla)"),
    topeDiarioPesos: z.string().describe("El tope diario en pesos tal como lo escribió el dueño (ej. '100.000'; sugerile $100.000)"),
    confirmado: z.boolean().describe("true solo si el dueño ya confirmó que la wallet es una donde él firma (MiniPay/Valora), no de un exchange"),
  }),
  execute(input, ctx) {
    if (looksLikeSecret(input.walletDelDuenio)) {
      return { estado: "error", mensaje: "Eso parece una clave privada o una frase semilla. Decile que borre el mensaje YA y que genere una clave nueva: quien la tiene se queda con toda la plata. Yo solo necesito la dirección 0x pública." };
    }
    const pesos = parsePesosTexto(input.topeDiarioPesos);
    if (pesos === null) {
      return { estado: "error", mensaje: `El tope diario tiene que ser un número en pesos (punto = miles, coma = decimales, hasta $${MAX_TOPE_PESOS.toLocaleString("es-AR")}). Pedile que lo escriba de nuevo.` };
    }
    if (!input.confirmado) {
      return {
        estado: "pendiente_confirmacion",
        mensaje:
          "Antes de crear la caja, avisale al dueño: la wallet que pasa es la ÚNICA que puede sacar la plata del vault. Tiene que ser una dirección donde él firme con su propia clave (MiniPay o Valora), nunca la dirección de depósito de un exchange ni una que no controle: si no, la plata queda trabada para siempre. Pedile que confirme que es suya y recién ahí volvé a llamarme.",
      };
    }
    return creadorVault().crear(chatIdDe(ctx), input.walletDelDuenio.trim(), pesosToWei(pesos, MAX_TOPE_PESOS));
  },
});
