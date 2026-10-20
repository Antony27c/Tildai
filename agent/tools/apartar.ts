import { defineTool } from "eve/tools";
import { z } from "zod";

import { apartar, idDeOperacion } from "../src/fondos.ts";
import { attrsDe, opsDelChat } from "../src/runtime.ts";

export default defineTool({
  description:
    "Aparta plata del operativo al ahorro o a los impuestos (no sale del vault). El monto lo fija el dueño o la regla del cierre de caja; nunca lo inventes. Si devuelve 'ya_ejecutada' no se movió nada de nuevo. Si da error, avisale al dueño tal cual.",
  inputSchema: z.object({
    bucket: z.enum(["ahorro", "impuestos"]),
    monto: z.number().positive().describe("Monto en pesos argentinos, hasta 2 decimales"),
  }),
  execute: (input, ctx) => apartar(opsDelChat(ctx), { ...input, idOperacion: idDeOperacion("apartar", attrsDe(ctx), input.bucket, input.monto) }),
});
