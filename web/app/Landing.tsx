"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./Landing.module.css";

const BOT_URL = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL;

const pesos = (n: number) => `$${n.toLocaleString("es-AR")}`;

const SAMPLE_SALES = [8500, 4300, 1200, 6700, 9800, 2300, 5400, 7600];

const reveal = (delay = 0) =>
  ({ "data-reveal": true, style: { "--d": `${delay}ms` } }) as {
    "data-reveal": boolean;
    style: CSSProperties;
  };

function Tick({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

function Torn({ up }: { up?: boolean }) {
  const w = 480;
  const h = 9;
  const pts = ["0,0", `${w},0`];
  for (let x = w - 8; x > 0; x -= 16) pts.push(`${x},${h}`, `${x - 8},0`);
  return (
    <svg
      className={styles.torn}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points={pts.join(" ")} transform={up ? "rotate(180 240 4.5)" : undefined} />
    </svg>
  );
}

export default function Landing() {
  const [sales, setSales] = useState<number[]>(SAMPLE_SALES.slice(0, 3));
  const total = sales.reduce((a, b) => a + b, 0);
  const last = sales[sales.length - 1];
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = root.current?.querySelectorAll("[data-reveal]");
    if (!els?.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add(styles.in));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add(styles.in);
            io.unobserve(en.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className={styles.page} ref={root}>
      <header className={styles.bar}>
        <div className={styles.wrap}>
          <a href="#top" className={styles.brand}>
            Tildai
            <Tick className={styles.brandTick} />
          </a>
          <nav className={styles.nav}>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#tu-plata">Tu plata</a>
            {BOT_URL ? (
              <a className={styles.ctaSmall} href={BOT_URL}>
                Empezá
              </a>
            ) : null}
          </nav>
        </div>
      </header>

      <main id="top">
        <section className={`${styles.wrap} ${styles.hero}`}>
          <div className={styles.heroCopy}>
            <h1 className={styles.title}>Cada cobro, tildado.</h1>
            <p className={styles.lede}>
              Tildai atiende la caja de tu comercio: cobrás en pesos con un QR, te avisa cada venta
              por Telegram y te ordena la plata del día.
            </p>
            {BOT_URL ? (
              <p className={styles.heroActions}>
                <a className={styles.cta} href={BOT_URL}>
                  Empezá por Telegram
                </a>
              </p>
            ) : null}
            <p className={styles.note}>
              Sin instalar nada: hablás con un bot de Telegram como con un encargado.
            </p>
          </div>

          <div className={styles.ticketCol} data-ui>
            <div className={styles.ticket}>
              <Torn up />
              <div className={styles.ticketBody}>
                <p className={styles.ticketHead}>Caja de hoy</p>
                <ul className={styles.ticketList}>
                  {sales.map((s, i) => (
                    <li key={i} className={styles.line}>
                      <span>Venta #{i + 1}</span>
                      <span className={styles.amount}>{pesos(s)}</span>
                      <Tick className={styles.lineTick} />
                    </li>
                  ))}
                </ul>
                <p className={styles.ticketTotal}>
                  <span>Total del día</span>
                  <span className={styles.amount}>{pesos(total)}</span>
                </p>
              </div>
              <Torn />
            </div>
            <button
              type="button"
              className={styles.simulate}
              onClick={() =>
                setSales((v) => [...v, SAMPLE_SALES[v.length % SAMPLE_SALES.length]])
              }
            >
              Simulá un cobro
            </button>
            <div className={styles.bubble} aria-live="polite">
              <p className={styles.bubbleLabel}>Así llega el aviso a Telegram</p>
              <p className={styles.bubbleMsg}>
                <Tick className={styles.bubbleTick} /> Entraron {pesos(last)} · venta #{sales.length}
              </p>
            </div>
          </div>
        </section>

        <section className={`${styles.wrap} ${styles.section}`} id="como-funciona">
          <h2 className={styles.heading} {...reveal()}>
            Cómo funciona
          </h2>
          <div className={styles.howGrid}>
            <figure className={styles.photo} {...reveal(80)}>
              <img
                src="/img/almacen-san-telmo.jpg"
                alt="Vidriera y entrada de un almacén de barrio en San Telmo, Buenos Aires."
                width={1920}
                height={1280}
                loading="lazy"
                decoding="async"
              />
              <figcaption className={styles.caption}>
                Un almacén de barrio en San Telmo, Buenos Aires.
              </figcaption>
            </figure>
            <ol className={styles.steps}>
              <li {...reveal(160)}>
                <strong>Mostrá el QR en el mostrador.</strong> Tu cliente lo escanea, escribe el
                monto y paga en pesos desde el celu, sin pagar nada extra.
              </li>
              <li {...reveal(240)}>
                <strong>Te llega el aviso.</strong> Por cada venta te llega un mensaje a Telegram con
                el monto. Sin mirar la caja, ya sabés qué entró.
              </li>
              <li {...reveal(320)}>
                <strong>La caja se cierra sola.</strong> Al final del día Tildai te manda el cierre:
                cuánto vendiste y qué quedó apartado.
              </li>
            </ol>
          </div>
        </section>

        <section className={`${styles.wrap} ${styles.section} ${styles.split}`}>
          <div data-ui {...reveal(80)}>
            <div className={styles.ticket}>
              <Torn up />
              <div className={styles.ticketBody}>
                <p className={styles.ticketHead}>Cierre del día</p>
                <ul className={styles.ticketList}>
                  <li className={styles.line}><span>Ventas</span><span className={styles.amount}>$52.300</span></li>
                  <li className={styles.line}><span>Ahorro apartado</span><span className={styles.amount}>$5.230</span></li>
                  <li className={styles.line}><span>Impuestos apartados</span><span className={styles.amount}>$7.800</span></li>
                  <li className={styles.line}><span>Pasado a dólares</span><span className={styles.amount}>$20.000</span></li>
                </ul>
                <p className={styles.ticketTotal}>
                  <span>Te queda en la caja</span>
                  <span className={styles.amount}>$19.270</span>
                </p>
              </div>
              <Torn />
            </div>
            <p className={styles.caption}>Así se ve un cierre de ejemplo.</p>
          </div>
          <div>
            <h2 className={styles.heading} {...reveal()}>
              El agente ordena la plata
            </h2>
            <ul className={styles.facts}>
              <li {...reveal(160)}>
                <strong>Apartá ahorro e impuestos.</strong> Le decís qué porcentaje separar de cada
                venta y Tildai lo aparta solo, todos los días.
              </li>
              <li {...reveal(240)}>
                <strong>El excedente puede pasar a dólares.</strong> Lo que sobra se dolariza para
                que no se lo coma la inflación. Lo activás y lo pausás vos.
              </li>
              <li {...reveal(320)}>
                <strong>Todo queda anotado.</strong> Cada movimiento queda registrado y te lo cuenta
                por Telegram, en criollo.
              </li>
            </ul>
          </div>
        </section>

        <figure className={styles.band} {...reveal()}>
          <img
            src="/img/verduleria-martinez.jpg"
            alt="Cajones de fruta en la vereda de una verdulería de barrio en Martínez, Buenos Aires."
            width={1920}
            height={1032}
            loading="lazy"
            decoding="async"
          />
          <figcaption className={`${styles.wrap} ${styles.bandCaption}`}>
            Una verdulería de barrio en Martínez, Buenos Aires.
          </figcaption>
        </figure>

        <section className={styles.trust} id="tu-plata">
          <div className={`${styles.wrap} ${styles.trustInner}`}>
            <h2 className={styles.heading} {...reveal()}>
              La plata es siempre tuya
            </h2>
            <ul className={styles.trustList}>
              <li {...reveal(120)}>
                <Tick className={styles.trustTick} />
                <span>Cada cobro cae directo en tu caja digital, a tu nombre. No pasa por Tildai.</span>
              </li>
              <li {...reveal(200)}>
                <Tick className={styles.trustTick} />
                <span>Podés retirar todo cuando quieras. Sin permiso, sin trámites.</span>
              </li>
              <li {...reveal(280)}>
                <Tick className={styles.trustTick} />
                <span>El agente solo mueve plata a donde vos le autorices, con un tope diario que elegís vos.</span>
              </li>
            </ul>
            <p className={styles.trustNote} {...reveal(360)}>
              Los cobros se hacen en wARS, el peso argentino digital de Ripio, sobre la red Celo.
              Tu cliente paga en pesos: no necesita saber nada de cripto.
            </p>
          </div>
        </section>

        {BOT_URL ? (
          <section className={`${styles.wrap} ${styles.section} ${styles.final}`}>
            <h2 className={styles.heading} {...reveal()}>
              Empezá por Telegram
            </h2>
            <p className={styles.finalText} {...reveal(80)}>
              Escribile a Tildai, contale cómo es tu comercio y en unos minutos tenés tu QR para
              cobrar.
            </p>
            <p className={styles.heroActions} {...reveal(160)}>
              <a className={styles.cta} href={BOT_URL}>
                Empezá por Telegram
              </a>
            </p>
          </section>
        ) : null}
      </main>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <p className={styles.footerBrand}>
            Tildai
            <Tick className={styles.brandTick} />
          </p>
          <p className={styles.footerText}>
            Cada cobro, tildado. Proyecto de código abierto. Cobros en wARS de Ripio sobre la red
            Celo.
          </p>
          <p className={styles.footerCredits}>
            Fotos: “Almacén Don Manolo en San Telmo” de ProtoplasmaKid y “Tenta verdulería” de
            Fernando Martello, CC BY-SA 4.0, vía Wikimedia Commons.
          </p>
        </div>
      </footer>
    </div>
  );
}
