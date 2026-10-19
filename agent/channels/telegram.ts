import { defaultTelegramAuth, telegramChannel } from "eve/channels/telegram";

// Fail closed: only the owner's private chat reaches the agent.
export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  onMessage(_ctx, message) {
    const owner = process.env.TILDAI_OWNER_CHAT_ID;
    if (message.chat.id !== owner) {
      console.error(`[tildai] mensaje ignorado del chat ${message.chat.id}; para habilitarlo definí TILDAI_OWNER_CHAT_ID`);
      return null;
    }
    const auth = defaultTelegramAuth(message);
    return auth && { auth };
  },
});
