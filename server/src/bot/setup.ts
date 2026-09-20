import type { Bot } from "grammy";

/**
 * Points Telegram at this server and configures commands and the menu button.
 * Idempotent: safe to run on every start.
 */
export async function configureBot(bot: Bot, o: { serverUrl: string; webhookSecret: string; webappUrl: string }) {
  await bot.api.setWebhook(`${o.serverUrl.replace(/\/$/, "")}/telegram/webhook`, {
    secret_token: o.webhookSecret,
    allowed_updates: ["message", "my_chat_member"],
  });
  await bot.api.setMyCommands([
    { command: "start", description: "Открыть мой вишлист" },
    { command: "share", description: "Ссылка на вишлист для друзей" },
    { command: "help", description: "Что умеет бот" },
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Мой вишлист", web_app: { url: o.webappUrl } } });
}
