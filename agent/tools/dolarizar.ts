import { defineTool } from "eve/tools";
import { z } from "zod";

import { dolarizar, idDeOperacion } from "../src/fondos.ts";
import { attrsDe, fx, opsDelChat } from "../src/runtime.ts";

export default defineTool({
  description:
    "Dolariza (cambia a USD₮ en Textile FX) plata del operativo, el ahorro o los impuestos. El monto en pesos lo da el dueño o la regla; nunca lo inventes. Si resultado es 'rechazada', transmití el mensaje tal cual (pasa cuando la cotización supera el precio máximo, falta el permiso del dueño para dolarizar apartados, o la cotización venció). Si da error o 'ya_ejecutada', decilo tal cual.",
  inputSchema: z.object({
    bucket: z.enum(["operativo", "ahorro", "impuestos"]),
    monto: z.number().positive().describe("Monto en pesos argentinos, hasta 2 decimales"),
  }),
  execute: (input, ctx) => dolarizar(opsDelChat(ctx), fx, { ...input, idOperacion: idDeOperacion("dolarizar", attrsDe(ctx), input.bucket, input.monto) }),
});
