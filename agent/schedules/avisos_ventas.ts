import { defineSchedule } from "eve/schedules";
import telegram from "../channels/telegram";

import { avisarEventos } from "../src/avisos.ts";
import { eventCursor, indexer, vaultsConChat } from "../src/runtime.ts";

// Every minute: delivers new /events to each merchant's chat. The persisted cursor only moves after a sent message.
export default defineSchedule({
  cron: "* * * * *",
  async run({ to, waitUntil, appAuth }) {
    const idx = indexer();
    if (!idx) return; // sin indexer no hay avisos: las ventas solo se consultan
    try {
      await avisarEventos({
        indexer: idx,
        cursor: eventCursor(),
        vaults: vaultsConChat().map((j) => ({ chatId: j.chatId, vault: j.vault.address })),
        send: async (chatId, texto) => {
          // Se espera la sesión además de aparcarla: si el envío falla, el cursor no avanza y el próximo tick reintenta.
          const p = to(telegram, { chatId }).send(`Avisale al dueño esto tal cual, sin cambiar nada:\n\n${texto}`, { auth: appAuth });
          waitUntil(p);
          await p;
        },
      });
    } catch (err) {
      console.error("[tildai] avisos: falló la pasada, reintenta en el próximo tick", err);
    }
  },
});
