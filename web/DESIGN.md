# DESIGN.md — Sistema visual de Tildai

Sistema visual de la web (`web/`). Los tokens viven en `app/globals.css`; todas las pantallas
los usan vía CSS Modules. Sin Tailwind ni librerías de estilos.

## Idea

**El ticket de caja.** Tildai ordena la caja de un comercio de barrio: el papel donde cada
venta queda tildada es el motivo visual. Piedra clarito, tinta oscura, una tilde verde.
La audiencia no es cripto: la web se ve y se lee como algo de barrio, no como una fintech.
Las fotos muestran el mundo real del usuario: comercios de barrio de Buenos Aires.

## Color

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#f3f4f1` | Fondo de página (piedra con tinte verdoso). |
| `--surface` | `#fafbf9` | Superficies: tickets, burbujas, footer. Un paso de tono sobre `--bg`, nunca sombra ni borde para separar. |
| `--fg` | `#201c14` | Tinta: todo el texto corrido y títulos. |
| `--muted` | `#5f6158` | Texto secundario, captions, notas. No usar para texto principal. |
| `--border` | `#e0e2dc` | La línea de corte del ticket (dashed) y separadores puntuales. |
| `--accent` | `#0e7a3d` | Verde tilde. Solo acciones (botones, CTA) y marcas de "cobrado/ok". Un campo de color pleno por página como máximo. |
| `--accent-fg` | `#ffffff` | Texto/iconos sobre `--accent`. |
| `--ok` | `#0e7a3d` | Estados positivos (misma familia que accent). |
| `--warn` | `#a35c00` | Advertencias, pendientes. |
| `--danger` | `#b3261e` | Errores, estados fallidos. |

Contraste verificado ≥4.5:1 para `--fg`, `--muted`, `--accent`, `--warn`, `--danger` sobre `--bg`;
`--accent-fg` sobre `--accent` ≈5.5:1.

## Tipografía

- `--font-sans`: stack del sistema. Toda la UI, incluidos los montos (con
  `font-variant-numeric: tabular-nums` para que las cifras alineen).
- `--font-mono`: solo para datos técnicos literales (direcciones, hashes, ids), nunca como
  estilo ni para montos.
- Display: `clamp(2.6rem, 9vw, 4.4rem)`, `letter-spacing: -0.03em`, `line-height ≈ 1`.
- Títulos de sección: `clamp(1.75rem, 5vw, 2.5rem)`, `letter-spacing: -0.02em`.
- Cuerpo: 17px base (en `globals.css`), `line-height: 1.55`, medida máx ~46ch en párrafos.
- A lo sumo 5 tamaños por página. Texto alineado a la izquierda; centrar un solo momento.

## Espaciado y forma

- Escala `--s1`…`--s6` = 4, 8, 12, 16, 24, 48 px. Dentro de una sección se usa s1–s5;
  entre secciones s6 o `calc(var(--s6) * 2)` en desktop.
- Ancho de página: `max-width: 1060px`, márgenes iguales (`--s4` mobile, `--s5` desktop).
- `--radius: 8px` para superficies (tarjetas, burbujas). Botones: píldora (`999px`), una sola
  forma en todo el sitio. Tickets: esquinas rectas con borde rasgado (ver abajo).
- Separar superficies por paso de tono, no por líneas ni sombras. Sin gradientes.

## El ticket (motivo)

El recibo con borde rasgado es el artefacto propio: papel `--surface` sobre `--bg`, esquinas
rectas, borde superior e inferior en zigzag (SVG plano), separador del total en dashed.
Se usa para mostrar datos del producto (caja del día, cierre). Reglas:

- Contenido real o de ejemplo claramente marcado ("Así se ve un cierre de ejemplo").
- Montos en la cara de texto con `tabular-nums`, alineados a la derecha.
- La tilde es el único "icono": SVG de trazo `stroke-width 2.2`, punta redonda, color `--ok`
  o `--accent`. No usar emoji ni ✓ Unicode.
- El fragmento lleva `data-ui` para identificarlo como UI de producto.

## Imágenes

Fotos reales del mundo del comercio (descargadas de colecciones abiertas a `public/img/`,
con crédito en el footer). Nunca presentadas como locales propios del producto: la caption
dice qué son. Actuales:

- `almacen-san-telmo.jpg` — "Almacén Don Manolo en San Telmo", ProtoplasmaKid, CC BY-SA 4.0.
- `verduleria-martinez.jpg` — "Tenta verdulería", Fernando Martello, CC BY-SA 4.0.

Si se agregan, misma regla: colección abierta, crédito en el footer, caption honesta.

## Estados y movimiento

- `:focus-visible` con anillo `--accent` (definido en globals). No quitar.
- `::selection` en `--accent`.
- Hover de botones: `translateY(-1px)` + oscurecer; `:active` escala 0.98.
- Animaciones solo `transform`/`opacity`, siempre detrás de
  `@media (prefers-reduced-motion: no-preference)`:
  - entrada del hero en cascada (60–90ms de desfasaje);
  - reveal on-scroll: `data-reveal` + IntersectionObserver agrega `.in`; si JS falla,
    el contenido queda visible;
  - la línea nueva del ticket sube y la tilde se dibuja (`stroke-dashoffset`);
  - la foto de la banda hace un drift lento (scale);
  - `scroll-behavior: smooth` en globals.
- El momento de firma: la tilde que se dibuja al "cobrar" en el ticket del hero.

## Marca

Los assets de marca viven en las convenciones de Next (`app/`), que los sirve solas.
**El logo definitivo se está generando:** cuando llegue, alcanza con reemplazar los
archivos, sin tocar código ni `layout.tsx`.

| Archivo | Qué es | Reemplazo |
|---|---|---|
| `app/icon.svg` | Favicon (tilde blanca sobre verde `--accent`). | `app/icon.svg` o `icon.png` del logo final. |
| `app/apple-icon.png` | Ícono iOS 180×180, cuadrado pleno (iOS le pone la máscara). | PNG 180×180 del logo final, fondo pleno. |
| `app/opengraph-image.tsx` | Imagen OG 1200×630 generada con `next/og`: fondo `--bg`, wordmark en `--fg` + tilde `--accent`. | Regenerar con el logo, o reemplazar por `opengraph-image.png` estático. |
| `public/img/*.jpg` | Fotos del mundo del comercio (CC BY-SA, crédito en el footer). | Agregar/reemplazar manteniendo crédito y caption honesta. |

El wordmark de la barra y el footer ("Tildai" + tilde SVG de `cobro/Tick.tsx`) es texto,
no imagen: si el logo final trae lettering propio, se actualiza en `Landing.tsx`.

## Voz

Español rioplatense, segunda persona: "cobrás", "tu plata", "podés retirar". Honesto y sin
jerga cripto en el primer plano; la parte técnica (wARS de Ripio, Celo) va en nota chica.
No se inventan métricas, testimonios ni clientes.

## Reglas duras (house style)

- Sin eyebrow/kicker sobre títulos, sin badges tipo píldora.
- Sin grillas de tarjetas con icono; cada sección tiene su propia composición.
- Sin sombras en elementos en reposo, sin glass, sin gradientes, sin blobs.
- Títulos de máximo dos líneas a cualquier ancho.
- `--font-mono` solo para datos técnicos; nada de monospace decorativo ni caps trackeadas.
- Numeración solo en listas reales (`<ol>`), sin "01 / 02" decorativos.
