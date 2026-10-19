import { defineTool } from "eve/tools";
import { z } from "zod";

import { retirar } from "../src/fondos.ts";
import { rampChainId, vaultOps } from "../src/runtime.ts";

export default defineTool({
  description:
    "Retira plata operativa a la wallet de retiro del dueño (el único destino posible) y devuelve el link de Ripio para pasarla a pesos. El monto lo dice el dueño; nunca lo inventes. Si da error o 'ya_ejecutada', decilo tal cual.",
  inputSchema: z.object({
    monto: z.number().positive().describe("Monto en pesos argentinos, hasta 2 decimales"),
    idOperacion: z.string().min(1).optional().describe("Id de negocio. Reusalo al reintentar; usá uno distinto solo si el dueño pide repetir a propósito."),
  }),
  execute: (input) => retirar(vaultOps(), input, rampChainId()),
});
