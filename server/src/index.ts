import { webhookCallback } from "grammy";
import { createApp } from "./app.js";
import { createBot } from "./bot/bot.js";
import { configureBot } from "./bot/setup.js";
import { loadConfig, webhookSecret } from "./config.js";
import { connectDb } from "./db/client.js";
import { deleteOrphanImages } from "./services/images.js";
import { createNotifier } from "./services/notify.js";
import { createVision } from "./services/vision.js";

const cfg = loadConfig();
const { db } = await connectDb(cfg.DATABASE_URL);

const bot = createBot(cfg, db);
const notifier = createNotifier((chatId, text) => bot.api.sendMessage(chatId, text));
const vision = createVision({
  provider: cfg.VISION_PROVIDER,
  anthropicKey: cfg.ANTHROPIC_API_KEY,
  openaiKey: cfg.OPENAI_API_KEY,
  model: cfg.VISION_MODEL,
});
if (!vision) console.warn("No ANTHROPIC_API_KEY / OPENAI_API_KEY: screenshot recognition is disabled");

const app = createApp({
  cfg,
  db,
  notifier,
  vision,
  webhook: webhookCallback(bot, "express", { secretToken: webhookSecret(cfg) }),
});

// Updates arrive by webhook in production. Polling is an explicit local-dev opt-in
// because it deletes the bot's webhook (see BOT_POLLING in config.ts).
if (cfg.BOT_POLLING === "1") {
  bot.start({ onStart: (me) => console.log(`bot @${me.username} polling`) }).catch((e) => console.error("bot polling stopped", e));
} else {
  bot.init().catch((e) => console.error("bot.init failed", e));
  const serverUrl = cfg.PUBLIC_URL ?? cfg.RENDER_EXTERNAL_URL;
  if (cfg.AUTO_SETUP_BOT === "1") {
    if (!serverUrl) console.error("AUTO_SETUP_BOT=1 but neither PUBLIC_URL nor RENDER_EXTERNAL_URL is set");
    else
      configureBot(bot, { serverUrl, webhookSecret: webhookSecret(cfg), webappUrl: cfg.WEBAPP_URL })
        .then(() => console.log(`Telegram webhook → ${serverUrl}/telegram/webhook`))
        .catch((e) => console.error("configureBot failed", e));
  }
  if (cfg.AUTO_SETUP_BOT !== "1") console.warn("AUTO_SETUP_BOT=0: Telegram keeps sending updates to whatever webhook is set now");
}

const sweep = () => deleteOrphanImages(db).catch((e) => console.error("image cleanup failed", e));
void sweep();
setInterval(sweep, 6 * 3600_000).unref();

app.listen(cfg.PORT, () => console.log(`wishlist-server listening on :${cfg.PORT}`));
