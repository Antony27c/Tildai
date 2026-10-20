import { defineSchedule } from "eve/schedules";
import { sendTelegramMessage } from "eve/channels/telegram";

import { cierreDeTodos } from "../src/cierreApartado.ts";
import { datosDelVault, indexer, opsDelVault, vaultsConChat } from "../src/runtime.ts";

// 21:00 ART = 00:00 UTC (Vercel evaluates cron in UTC). One close per registered vault, each to its own chat.
export default defineSchedule({
  cron: "0 0 * * *",
  async run() {
    const jobs = vaultsConChat();
    if (!jobs.length) {
      console.error("[tildai] cierre: no hay vaults que cerrar (registro vacío y falta TILDAI_VAULT o TILDAI_OWNER_CHAT_ID)");
      return;
    }
    await cierreDeTodos({
      jobs,
      datos: datosDelVault,
      ops: opsDelVault,
      env: { savings: process.env.TILDAI_SAVINGS_PCT, taxes: process.env.TILDAI_TAXES_PCT },
      indexer: indexer(),
      // Direct send, not a model session: the text goes verbatim and the real Telegram error propagates.
      send: (chatId, texto) => sendTelegramMessage({ chatId, body: { text: texto } }),
    });
  },
});
