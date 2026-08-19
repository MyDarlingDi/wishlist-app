import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webhookCallback } from "grammy";

import { bot } from "./bot.js";
import { requireTelegramAuth } from "./telegramAuth.js";
import profileRoutes from "./routes/profile.js";
import wishlistRoutes from "./routes/wishlist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const USE_WEBHOOK = process.env.USE_WEBHOOK === "true";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "webhook";
const PUBLIC_URL = process.env.PUBLIC_URL;

// Если фронтенд задеплоен на отдельном домене (например Vercel), укажите его
// в ALLOWED_ORIGIN, чтобы ограничить CORS только им. Если не задано — разрешены все.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : {}));
app.use(express.json());

// --- Вебхук бота (должен стоять ДО express.json() конфликтов нет, grammy сам парсит raw) ---
if (USE_WEBHOOK) {
  app.use(`/bot/${WEBHOOK_SECRET}`, webhookCallback(bot, "express"));
}

// --- REST API для Mini App, всё под /api/* защищено проверкой initData ---
const api = express.Router();
api.use(requireTelegramAuth(BOT_TOKEN));
api.use(profileRoutes);
api.use(wishlistRoutes);
app.use("/api", api);

// --- Статика собранного Mini App (webapp/dist) ---
const webappDist = path.join(__dirname, "../../webapp/dist");
app.use(express.static(webappDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(webappDist, "index.html"));
});

app.listen(PORT, async () => {
  console.log(`Server listening on :${PORT}`);

  if (USE_WEBHOOK) {
    if (!PUBLIC_URL) throw new Error("PUBLIC_URL обязателен при USE_WEBHOOK=true");
    await bot.api.setWebhook(`${PUBLIC_URL}/bot/${WEBHOOK_SECRET}`);
    console.log("Webhook установлен:", `${PUBLIC_URL}/bot/${WEBHOOK_SECRET}`);
  } else {
    await bot.api.deleteWebhook().catch(() => {});
    bot.start();
    console.log("Бот запущен в режиме long polling");
  }
});
