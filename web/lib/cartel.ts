type Env = Record<string, string | undefined>;
type HeaderGetter = { get(name: string): string | null };

// Misma regla que page.tsx: NEXT_PUBLIC_BASE_URL o el host del pedido.
export function cartelBase(env: Env, h: HeaderGetter): string {
  return env.NEXT_PUBLIC_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

// Link de cobro fijo del vault, mismo formato que el QR del mostrador: <base>/?vault=<vault>
export function counterUrl(vault: string, base: string): string {
  return `${base.replace(/\/+$/, "")}/?vault=${vault}`;
}

// Nombre del comercio: sin caracteres de control/formato, máximo 40. El escapado
// HTML lo hace React al renderizarlo como texto; acá solo se sanea la forma.
export function sanitizeNombre(nombre: string | undefined): string | undefined {
  if (!nombre) return undefined;
  const clean = [...nombre.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, 40).join("");
  return clean || undefined;
}
