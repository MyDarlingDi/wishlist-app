import { Bot, InlineKeyboard } from "grammy";
import "dotenv/config";
import { upsertUser, addStars } from "./db.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL; // адрес БЭКЕНДА (Render) — для вебхука
// адрес ФРОНТЕНДА (Vercel) — то, что реально открывается как Mini App.
// Если не задан отдельно, используем PUBLIC_URL (актуально при деплое всё-в-одном).
const WEBAPP_URL = (process.env.WEBAPP_URL || PUBLIC_URL || "").trim().replace(/\/+$/, "");
const WEBAPP_SHORT_NAME = process.env.WEBAPP_SHORT_NAME || "wishlist";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN не задан в .env");
}

export const bot = new Bot(BOT_TOKEN);

async function syncProfileFromTelegram(ctx, tgId) {
  // getChat отдаёт bio и birthdate ТОЛЬКО если сам пользователь разрешил
  // показывать их ботам в настройках приватности Telegram.
  let bio = null;
  let birthdate = null;
  let photo_url = null;
  try {
    const chat = await ctx.api.getChat(tgId);
    bio = chat.bio || null;
    if (chat.birthdate) {
      const b = chat.birthdate;
      birthdate = [b.day, b.month, b.year].filter(Boolean).join(".");
    }
    if (chat.photo?.big_file_id) {
      const file = await ctx.api.getFile(chat.photo.big_file_id);
      photo_url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    }
  } catch (e) {
    // недостаточно прав / пользователь скрыл данные — это нормально, просто пропускаем
  }

  return await upsertUser({
    tg_id: tgId,
    first_name: ctx.from.first_name || "",
    last_name: ctx.from.last_name || "",
    username: ctx.from.username || null,
    photo_url,
    bio,
    birthdate,
  });
}

bot.command("start", async (ctx) => {
  await syncProfileFromTelegram(ctx, ctx.from.id);

  const startParam = ctx.match; // deep-link параметр после /start
  const webAppUrl = startParam
    ? `${WEBAPP_URL}/?tgWebAppStartParam=${encodeURIComponent(startParam)}`
    : WEBAPP_URL;

  const kb = new InlineKeyboard().webApp("🎁 Открыть вишлист", webAppUrl);

  await ctx.reply(
    "Привет! Здесь можно собрать вишлист подарков и поделиться им с друзьями — они смогут бронировать подарки так, что вы этого не увидите 😉",
    { reply_markup: kb }
  );

  // Делаем Mini App доступным через кнопку меню чата — это и есть "красивый" постоянный вход
  try {
    await ctx.api.setChatMenuButton({
      chat_id: ctx.from.id,
      menu_button: { type: "web_app", text: "Вишлист", web_app: { url: WEBAPP_URL } },
    });
  } catch {
    // игнорируем, если не удалось (например, недостаточно прав)
  }
});

// Создать ссылку на оплату Telegram Stars ("подарить звёзды" владельцу вишлиста)
export async function createStarsInvoiceLink({ ownerId, amount, fromName }) {
  return bot.api.createInvoiceLink(
    `Подарок ${amount} ⭐`,
    "Звёзды в вишлист",
    JSON.stringify({ ownerId, fromName }),
    "", // provider_token не нужен для валюты XTR
    "XTR",
    [{ label: `${amount} ⭐`, amount }]
  );
}

bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  if (payment.currency !== "XTR") return;
  let payload = {};
  try {
    payload = JSON.parse(payment.invoice_payload);
  } catch {
    return;
  }
  if (!payload.ownerId) return;

  await addStars(payload.ownerId, payment.total_amount);

  try {
    await ctx.api.sendMessage(
      payload.ownerId,
      `🌟 Вам подарили ${payment.total_amount} звёзд${
        payload.fromName ? ` от ${payload.fromName}` : ""
      }! Загляните в свой вишлист, чтобы увидеть баланс.`
    );
  } catch {
    // пользователь мог заблокировать бота — не критично
  }
});

export async function ensureUserSynced(ctx, tgId) {
  return syncProfileFromTelegram(ctx, tgId);
}
