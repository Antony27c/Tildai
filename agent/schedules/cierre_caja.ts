import { defineSchedule } from "eve/schedules";
import telegram from "../channels/telegram";

import { book } from "../src/runtime.ts";
import { cierreCaja } from "../src/sales.ts";

// 21:00 ART = 00:00 UTC (Vercel evaluates cron in UTC). Only builds the summary: it moves no funds.
export default defineSchedule({
  cron: "0 0 * * *",
  async run({ to, waitUntil, appAuth }) {
    const chatId = process.env.TILDAI_OWNER_CHAT_ID;
    if (!chatId) throw new Error("Falta TILDAI_OWNER_CHAT_ID: no se puede enviar el cierre de caja");
    const { resumen } = await cierreCaja(book);
    waitUntil(to(telegram, { chatId }).send(`Enviale al dueño este resumen tal cual, sin cambiar cifras:\n\n${resumen}`, { auth: appAuth }));
  },
});
