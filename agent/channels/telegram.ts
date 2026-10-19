import { defaultTelegramAuth, telegramChannel } from "eve/channels/telegram";

import { looksLikeSecret } from "../src/secrets.ts";

const AVISO_SECRETO =
  "Cuidado: lo que mandaste parece una clave privada o una frase semilla. Borrá el mensaje YA y generá una clave nueva, porque quien la tiene se queda con toda tu plata. Yo nunca te voy a pedir tu clave ni tu frase: solo tu dirección 0x.";

// Secrets never reach the model: they're deleted here. Without TILDAI_OWNER_CHAT_ID, any private chat can /start and get its own vault.
export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  onMessage(ctx, message) {
    if (looksLikeSecret(`${message.text}\n${message.caption}`)) {
      ctx.telegram.sendMessage(AVISO_SECRETO).catch((e) => console.error("[tildai] no pude avisar del secreto", e));
      return null;
    }
    const owner = process.env.TILDAI_OWNER_CHAT_ID;
    if (owner && message.chat.id !== owner) {
      console.error(`[tildai] mensaje ignorado del chat ${message.chat.id}; para habilitarlo definí TILDAI_OWNER_CHAT_ID`);
      return null;
    }
    const auth = defaultTelegramAuth(message);
    return auth && { auth };
  },
});
