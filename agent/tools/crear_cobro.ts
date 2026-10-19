import { defineTool } from "eve/tools";
import { z } from "zod";

import { bookDelChat, payBaseUrl } from "../src/runtime.ts";
import { crearCobro } from "../src/sales.ts";

export default defineTool({
  description:
    "Crea un cobro en pesos (wARS) y devuelve el link de pago. El monto lo pone el dueño en su pedido; nunca inventes ni redondees montos. La venta queda pendiente hasta que se confirme el pago onchain.",
  inputSchema: z.object({ monto: z.number().positive().describe("Monto en pesos argentinos, hasta 2 decimales") }),
  execute: (input, ctx) => crearCobro(bookDelChat(ctx), input, payBaseUrl()),
});
