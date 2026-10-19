import { defineTool } from "eve/tools";
import { z } from "zod";

import { book } from "../src/runtime.ts";
import { ventasHoy } from "../src/sales.ts";

export default defineTool({
  description: "Total, cantidad de ventas cobradas hoy, ticket promedio y ventas pendientes de confirmar.",
  inputSchema: z.object({}),
  execute: () => ventasHoy(book),
});
