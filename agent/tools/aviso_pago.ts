import { defineTool } from "eve/tools";
import { z } from "zod";

import { book } from "../src/runtime.ts";
import { avisoPago } from "../src/sales.ts";

export default defineTool({
  description: "Revisa si entraron pagos nuevos y devuelve los avisos '✓ Entraron $X (venta #N)' que todavía no se informaron. Usala cuando el dueño pregunte si le pagaron.",
  inputSchema: z.object({}),
  execute: () => avisoPago(book),
});
