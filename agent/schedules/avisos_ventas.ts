import { defineSchedule } from "eve/schedules";
import { sendTelegramMessage } from "eve/channels/telegram";

import { avisarEventos } from "../src/avisos.ts";
import { eventCursor, indexer, vaultsConChat } from "../src/runtime.ts";

// Every minute: delivers new /events to each merchant's chat. The persisted cursor only moves after a sent message.
export default defineSchedule({
  cron: "* * * * *",
  async run() {
    const idx = indexer();
    if (!idx) return; // sin indexer no hay avisos: las ventas solo se consultan
    try {
      await avisarEventos({
        indexer: idx,
        cursor: eventCursor(),
        vaults: vaultsConChat().map((j) => ({ chatId: j.chatId, vault: j.vault.address })),
        // Direct send, not a model session: a real Telegram error (403, 429, 5xx) reaches
        // avisarEventos, which classifies it as permanent/transient and moves or holds the cursor.
        send: (chatId, texto) => sendTelegramMessage({ chatId, body: { text: texto } }),
      });
    } catch (err) {
      console.error("[tildai] avisos: falló la pasada, reintenta en el próximo tick", err);
    }
  },
});
