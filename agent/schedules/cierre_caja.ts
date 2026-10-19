import { defineSchedule } from "eve/schedules";
import telegram from "../channels/telegram";

import { apartadoCierre } from "../src/cierreApartado.ts";
import { balances, book, vaultOps } from "../src/runtime.ts";
import { cierreCaja } from "../src/sales.ts";

// 21:00 ART = 00:00 UTC (Vercel evaluates cron in UTC). Sends the summary, then sets aside savings and taxes.
export default defineSchedule({
  cron: "0 0 * * *",
  async run({ to, waitUntil, appAuth }) {
    const chatId = process.env.TILDAI_OWNER_CHAT_ID;
    if (!chatId) throw new Error("Falta TILDAI_OWNER_CHAT_ID: no se puede enviar el cierre de caja");
    const { resumen } = await cierreCaja(book);
    let apartado = "No aparté nada: no hay vault real configurado (TILDAI_VAULT).";
    if (balances) {
      try {
        apartado = (await apartadoCierre({ book, ops: vaultOps(), balances, env: { savings: process.env.TILDAI_SAVINGS_PCT, taxes: process.env.TILDAI_TAXES_PCT } })).texto;
      } catch (err) {
        console.error("[tildai] ALERTA cierre: falló el apartado", err);
        apartado = `No aparté nada: ${(err as Error).message}`;
      }
    }
    waitUntil(to(telegram, { chatId }).send(`Enviale al dueño este resumen tal cual, sin cambiar cifras:\n\n${resumen}\n\nApartado:\n${apartado}`, { auth: appAuth }));
  },
});
