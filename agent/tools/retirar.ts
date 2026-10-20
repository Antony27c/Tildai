import { defineTool } from "eve/tools";
import { z } from "zod";

import { idDeOperacion, retirar } from "../src/fondos.ts";
import { attrsDe, opsDelChat, rampChainId } from "../src/runtime.ts";

export default defineTool({
  description:
    "Retira plata operativa a la wallet de retiro del dueño (el único destino posible) y devuelve el link de Ripio para pasarla a pesos. El monto lo dice el dueño; nunca lo inventes. Si da error o 'ya_ejecutada', decilo tal cual.",
  inputSchema: z.object({
    monto: z.number().positive().describe("Monto en pesos argentinos, hasta 2 decimales"),
  }),
  execute: (input, ctx) => retirar(opsDelChat(ctx), { ...input, idOperacion: idDeOperacion("retirar", attrsDe(ctx), input.monto) }, rampChainId()),
});
