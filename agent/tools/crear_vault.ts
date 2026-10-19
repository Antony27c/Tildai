import { defineTool } from "eve/tools";
import { z } from "zod";

import { pesosToWei } from "../src/money.ts";
import { creadorVault } from "../src/runtime.ts";
import { looksLikeSecret } from "../src/secrets.ts";

export default defineTool({
  description:
    "Da de alta al comercio: crea su vault en la factory (una sola vez por chat). Llamala solo cuando ya tengas la wallet del dueño (0x de 42 caracteres) y el tope diario en pesos que eligió. Devuelve la dirección del vault, el link de cobro del QR fijo y los límites: pasáselos al dueño tal cual.",
  inputSchema: z.object({
    chatId: z.string().min(1).describe("El chat_id de <telegram_context>, para que este chat quede ligado a su vault"),
    walletDelDuenio: z.string().describe("Dirección 0x que pegó el dueño (nunca una clave privada ni una frase semilla)"),
    topeDiarioPesos: z.number().positive().describe("Tope diario en pesos que eligió el dueño (sugerí 100.000)"),
  }),
  execute(input) {
    if (looksLikeSecret(input.walletDelDuenio)) {
      return { estado: "error", mensaje: "Eso parece una clave privada o una frase semilla. Decile que borre el mensaje YA y que genere una clave nueva: quien la tiene se queda con toda la plata. Yo solo necesito la dirección 0x pública." };
    }
    let capWei;
    try {
      capWei = pesosToWei(input.topeDiarioPesos);
    } catch (err) {
      return { estado: "error", mensaje: `El tope diario no sirve: ${(err as Error).message}. Pedile otro número.` };
    }
    return creadorVault().crear(input.chatId, input.walletDelDuenio.trim(), capWei);
  },
});
