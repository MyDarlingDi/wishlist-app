/**
 * Manual alternative to AUTO_SETUP_BOT:
 *   SERVER_URL=https://<render-app>.onrender.com npm run setup:bot
 * Reads BOT_TOKEN and WEBAPP_URL from the environment.
 */
import { Bot } from "grammy";
import { configureBot } from "../bot/setup.js";
import { loadConfig, webhookSecret } from "../config.js";

const server = process.env.SERVER_URL;
if (!server) throw new Error("Set SERVER_URL");

const cfg = loadConfig();
const bot = new Bot(cfg.BOT_TOKEN);
await configureBot(bot, { serverUrl: server, webhookSecret: webhookSecret(cfg), webappUrl: cfg.WEBAPP_URL });
console.log("webhook:", await bot.api.getWebhookInfo());
