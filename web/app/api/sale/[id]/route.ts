import { saleStatusResponse } from "../../../../lib/indexer.ts";
import { parseSale } from "../../../../lib/sale.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sale = parseSale((await params).id);
  if (!sale.ok || !sale.sale) return Response.json({ error: "Venta inválida" }, { status: 400 });
  return saleStatusResponse(sale.sale);
}
