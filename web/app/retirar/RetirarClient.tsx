"use client";
import { useEffect, useState } from "react";
import type { Address, EIP1193Provider } from "viem";
import { formatToken, isOwner, refreshBalances, withdrawAll, type TokenBalance } from "../../lib/retirar.ts";
import styles from "./retirar.module.css";

type Phase = "idle" | "firmando" | "enviado" | "confirmado" | "rechazado" | "unknown" | "error";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const provider = () => (typeof window !== "undefined" ? (window as { ethereum?: EIP1193Provider }).ethereum : undefined);

export default function RetirarClient({ vault, chainId, owner, tokens: initial, scan }: {
  vault: string;
  chainId: number;
  owner: Address;
  tokens: TokenBalance[];
  scan: string;
}) {
  // undefined = todavía no se detectó (server y primer render coinciden); null = no hay wallet.
  const [wallet, setWallet] = useState<EIP1193Provider | null | undefined>(undefined);
  const [account, setAccount] = useState<Address | null>(null);
  const [tokens, setTokens] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setWallet(provider() ?? null);
  }, []);

  useEffect(() => {
    if (!wallet) return;
    const p = wallet as EIP1193Provider & { on?: (e: string, cb: (a: string[]) => void) => void; removeListener?: (e: string, cb: (a: string[]) => void) => void };
    p.request({ method: "eth_accounts" })
      .then((a) => Array.isArray(a) && a[0] && setAccount(a[0] as Address))
      .catch(() => {});
    const onAccounts = (a: string[]) => setAccount((a?.[0] as Address) ?? null);
    p.on?.("accountsChanged", onAccounts);
    return () => p.removeListener?.("accountsChanged", onAccounts);
  }, [wallet]);

  const conectar = async () => {
    setMsg(null);
    try {
      const a = (await wallet?.request({ method: "eth_requestAccounts" })) as Address[] | undefined;
      if (a?.[0]) setAccount(a[0]);
    } catch {
      setMsg("No pudimos conectar la billetera.");
    }
  };

  const retirar = async (t: TokenBalance) => {
    if (!wallet) return;
    setMsg(null);
    setHash(null);
    setBusy(t.token);
    setPhase("firmando");
    const r = await withdrawAll(wallet, chainId, vault as Address, t.token, {
      onSent: (h) => {
        setHash(h);
        setPhase("enviado");
      },
    });
    setBusy(null);
    if (r.kind === "confirmed") {
      setPhase("confirmado");
      const fresh = await refreshBalances(chainId, vault as Address, tokens);
      if (fresh) setTokens(fresh);
    } else if (r.kind === "unknown") {
      // La tx salió pero no sabemos si minó: releer saldos y avisar, sin afirmar nada.
      setPhase("unknown");
      setHash(r.hash);
      const fresh = await refreshBalances(chainId, vault as Address, tokens);
      if (fresh) setTokens(fresh);
    } else if (r.kind === "rejected") {
      setPhase("rechazado");
    } else {
      setPhase("error");
      setMsg(r.reason);
    }
  };

  if (wallet === undefined) {
    return (
      <section className={styles.card}>
        <p className={styles.text}>Buscando tu billetera…</p>
      </section>
    );
  }
  if (wallet === null) {
    return (
      <section className={styles.card}>
        <p className={styles.error}>Necesitás una billetera (como MetaMask o MiniPay) para retirar.</p>
      </section>
    );
  }
  if (!account) {
    return (
      <section className={styles.card}>
        <p className={styles.text}>Conectá la billetera dueña de la caja para ver los saldos y retirar.</p>
        <button className={styles.btn} onClick={conectar}>
          Conectar billetera
        </button>
        {msg && <p className={styles.error}>{msg}</p>}
      </section>
    );
  }
  if (!isOwner(account, owner)) {
    return (
      <section className={styles.card}>
        <p className={styles.error}>Esta billetera no es la dueña de esta caja</p>
        <p className={styles.text}>
          Conectada: <span className={styles.mono}>{short(account)}</span>
        </p>
      </section>
    );
  }
  const conSaldo = tokens.filter((t) => BigInt(t.balance) > 0n);
  return (
    <section className={styles.card}>
      <p className={styles.text}>
        Dueña: <span className={styles.mono}>{short(account)}</span>
      </p>
      {conSaldo.length === 0 && <p className={styles.text}>{phase === "confirmado" || phase === "unknown" ? "La caja quedó vacía." : "La caja está vacía."}</p>}
      {conSaldo.map((t) => (
        <div key={t.token} className={styles.row}>
          <div>
            <strong className={styles.amount}>
              {t.symbol} {formatToken(t.balance, t.decimals)}
            </strong>
          </div>
          <button className={styles.btn} disabled={busy !== null} onClick={() => retirar(t)}>
            {busy === t.token ? (phase === "firmando" ? "Firmando…" : "Esperando…") : "Retirar todo a mi billetera"}
          </button>
        </div>
      ))}
      {phase === "firmando" && <p className={styles.text}>Firmá en tu billetera…</p>}
      {phase === "enviado" && (
        <p className={styles.text}>
          Retiro enviado, esperando confirmación.{" "}
          {hash && (
            <a className={styles.link} href={`${scan}${hash}`} target="_blank" rel="noreferrer">
              Ver en el explorador
            </a>
          )}
        </p>
      )}
      {phase === "confirmado" && hash && (
        <p className={styles.ok}>
          Retiro confirmado{" "}
          <a className={styles.link} href={`${scan}${hash}`} target="_blank" rel="noreferrer">
            Ver en el explorador
          </a>
        </p>
      )}
      {phase === "unknown" && (
        <p className={styles.warn}>
          Mandaste el retiro pero no pudimos confirmarlo.{" "}
          {hash && (
            <a className={styles.link} href={`${scan}${hash}`} target="_blank" rel="noreferrer">
              Revisalo en el explorador
            </a>
          )}{" "}
          antes de volver a intentar.
        </p>
      )}
      {phase === "rechazado" && <p className={styles.text}>Rechazaste la firma. Podés intentarlo de nuevo.</p>}
      {phase === "error" && msg && <p className={styles.error}>{msg}</p>}
    </section>
  );
}
