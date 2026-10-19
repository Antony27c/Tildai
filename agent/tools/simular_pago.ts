import { defineTool } from "eve/tools";
import { z } from "zod";

import { vault } from "../src/runtime.ts";
import { pesosToWei } from "../src/money.ts";

export default defineTool({
  description: "SOLO DEMO LOCAL: simula un pago confirmado en el vault falso. Usala únicamente si el dueño lo pide explícitamente.",
  inputSchema: z.object({ monto: z.number().positive() }),
  execute({ monto }) {
    if (process.env.TILDAI_DEMO !== "1") throw new Error("simular_pago está deshabilitada (falta TILDAI_DEMO=1)");
    return { transferId: vault.deposit(pesosToWei(monto)).id };
  },
});
