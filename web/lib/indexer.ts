type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export type NotifyResult = { ok: true; status: string } | { ok: false; code: "not_found" | "conflict" | "error"; reason: string };
export type StatusResult =
  | { ok: true; status: string; vault?: string; amount?: string }
  | { ok: false; code: "not_found" | "error"; reason: string };

function call(path: string, init: RequestInit, env: Env, f: Fetch) {
  const base = env.TILDAI_INDEXER_URL;
  const token = env.TILDAI_INDEXER_TOKEN;
  if (!base || !token) throw new Error("Faltan TILDAI_INDEXER_URL o TILDAI_INDEXER_TOKEN");
  const u = new URL(base);
  // el Bearer viaja en texto plano con http: solo se permite en localhost
  if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
    throw new Error("TILDAI_INDEXER_URL debe ser https fuera de localhost");
  }
  return f(`${base.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
}

export async function notifyTx(saleId: string, txHash: string, env: Env = process.env, f: Fetch = fetch): Promise<NotifyResult> {
  try {
    const res = await call(`/sales/${encodeURIComponent(saleId)}/tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash }),
    }, env, f);
    if (res.ok) return { ok: true, status: String(((await res.json()) as { status?: unknown }).status) };
    if (res.status === 404) return { ok: false, code: "not_found", reason: "El indexer no conoce esa venta" };
    if (res.status === 409) return { ok: false, code: "conflict", reason: "La venta ya figura cobrada con otra tx" };
    return { ok: false, code: "error", reason: `El indexer respondió ${res.status}` };
  } catch (e) {
    return { ok: false, code: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function getSaleStatus(saleId: string, env: Env = process.env, f: Fetch = fetch): Promise<StatusResult> {
  try {
    const res = await call(`/sales/${encodeURIComponent(saleId)}`, { method: "GET" }, env, f);
    if (res.ok) {
      const j = (await res.json()) as { status?: unknown; vault?: unknown; amount?: unknown };
      return {
        ok: true,
        status: String(j.status),
        vault: typeof j.vault === "string" ? j.vault : undefined,
        amount: typeof j.amount === "string" ? j.amount : undefined,
      };
    }
    if (res.status === 404) return { ok: false, code: "not_found", reason: "Venta inexistente" };
    return { ok: false, code: "error", reason: `El indexer respondió ${res.status}` };
  } catch (e) {
    return { ok: false, code: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

// Antes de cobrar con x402: la venta tiene que existir, seguir pendiente y coincidir en vault y monto.
export type SaleCheck = "ok" | "conflict" | "unavailable";
export async function checkSalePending(
  saleId: string,
  vault: string,
  atomic: string,
  env: Env = process.env,
  f: Fetch = fetch,
): Promise<SaleCheck> {
  const r = await getSaleStatus(saleId, env, f);
  if (!r.ok) return r.code === "not_found" ? "conflict" : "unavailable";
  if (r.status !== "pendiente") return "conflict";
  if ((r.vault ?? "").toLowerCase() !== vault.toLowerCase()) return "conflict";
  if (r.amount !== atomic) return "conflict";
  return "ok";
}

// El pago ya ocurrió: si el indexer falla se loguea y se devuelve un aviso, nunca se dice "cobrado".
export async function reportPayment(saleId: string | null, txHash: string, env: Env = process.env, f: Fetch = fetch): Promise<string | undefined> {
  if (!saleId) return undefined;
  const r = await notifyTx(saleId, txHash, env, f);
  if (r.ok) return undefined;
  console.error(JSON.stringify({ event: "indexer_notify_failed", saleId, txHash, code: r.code, reason: r.reason }));
  return "El pago se hizo, pero todavía no pudimos avisarle al sistema del comercio. La confirmación puede demorar.";
}

export async function saleStatusResponse(saleId: string, env: Env = process.env, f: Fetch = fetch): Promise<Response> {
  const r = await getSaleStatus(saleId, env, f);
  if (r.ok) return Response.json({ status: r.status });
  if (r.code === "not_found") return Response.json({ error: "Venta inexistente" }, { status: 404 });
  console.error(JSON.stringify({ event: "indexer_status_failed", saleId, reason: r.reason }));
  return Response.json({ error: "No pudimos consultar el estado" }, { status: 503 });
}
