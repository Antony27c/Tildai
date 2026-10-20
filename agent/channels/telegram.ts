import { defaultTelegramAuth, telegramChannel } from "eve/channels/telegram";

import { chatHabilitado, deberiaAvisar } from "../src/alta.ts";
import { chatRegistry } from "../src/runtime.ts";
import { looksLikeSecret } from "../src/secrets.ts";

const AVISO_SECRETO =
  "Cuidado: lo que mandaste parece una clave privada o una frase semilla. Borrá el mensaje YA y generá una clave nueva, porque quien la tiene se queda con toda tu plata. Yo nunca te voy a pedir tu clave ni tu frase: solo tu dirección 0x.";

const AVISO_NO_AUTORIZADO =
  "Hola, soy Tildai, la caja de los comercios. El alta es por invitación y está cerrada para este chat. Si te convocaron, pedile al equipo que habilite este chat id.";

/** One "closed sign-up" reply per chat per process: strangers can't drain the bot's Telegram quota. */
const avisadosNoAutorizados = new Set<string>();

// Secrets never reach the model: they're deleted here. Sign-up spends agent gas, so unknown chats only get a
// polite reply unless they're allowlisted (TILDAI_ALLOWED_CHATS) or sign-up is open (TILDAI_OPEN_SIGNUP=1).
export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  onMessage(ctx, message) {
    if (looksLikeSecret(`${message.text}\n${message.caption}`)) {
      ctx.telegram.sendMessage(AVISO_SECRETO).catch((e) => console.error("[tildai] no pude avisar del secreto", e));
      return null;
    }
    if (!chatHabilitado(message.chat.id, chatRegistry(), process.env)) {
      console.error(`[tildai] mensaje ignorado del chat ${message.chat.id}: sin alta habilitada (TILDAI_ALLOWED_CHATS / TILDAI_OPEN_SIGNUP)`);
      if (deberiaAvisar(message.chat.id, avisadosNoAutorizados)) {
        ctx.telegram.sendMessage(AVISO_NO_AUTORIZADO).catch((e) => console.error("[tildai] no pude responder al chat no autorizado", e));
      }
      return null;
    }
    const auth = defaultTelegramAuth(message);
    return auth && { auth };
  },
});
