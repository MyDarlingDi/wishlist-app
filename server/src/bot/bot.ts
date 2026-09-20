import { Bot, InlineKeyboard } from "grammy";
import type { Config } from "../config.js";
import type { DB } from "../db/client.js";
import { wishlists } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { parseWishlistRef, shareLink, webAppUrl } from "../links.js";
import { displayName, ensureWishlist, getUser, upsertUser } from "../services/wishes.js";

const HELP = `Я помогаю собирать вишлисты и дарить подарки без спойлеров.

/start — открыть свой вишлист
/share — ссылка, которую можно отправить друзьям
/watch — (в групповом чате) присылать сюда уведомления о бронях и складчинах
/unwatch — отключить уведомления`;

export function createBot(cfg: Config, db: DB): Bot {
  const bot = new Bot(cfg.BOT_TOKEN);

  const remember = (from: { id: number; first_name: string; last_name?: string; username?: string }) =>
    upsertUser(db, from);

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    if (ctx.chat.type !== "private") {
      return ctx.reply("Откройте меня в личных сообщениях, чтобы работать с вишлистом. Для уведомлений в группе — команда /watch.");
    }
    await remember(ctx.from);

    const ownerId = parseWishlistRef(ctx.match);
    if (ownerId && ownerId !== ctx.from.id) {
      const owner = await getUser(db, ownerId);
      if (!owner) return ctx.reply("Вишлист не найден. Попросите друга прислать ссылку ещё раз.");
      return ctx.reply(
        `🎁 Вишлист: ${displayName(owner)}\n\nМожно тайно забронировать подарок или скинуться вскладчину — именинник ничего не увидит.`,
        { reply_markup: new InlineKeyboard().webApp("Открыть вишлист", webAppUrl(cfg, ownerId)) },
      );
    }
    return ctx.reply(
      "Привет! Здесь живёт ваш вишлист 🎁\nДобавляйте желания по скриншоту или ссылке, а друзья смогут тайно бронировать подарки.",
      { reply_markup: new InlineKeyboard().webApp("🎁 Мой вишлист", webAppUrl(cfg)) },
    );
  });

  bot.command("share", async (ctx) => {
    if (!ctx.from) return;
    await remember(ctx.from);
    return ctx.reply(`Ссылка на ваш вишлист — отправьте её друзьям:\n${shareLink(cfg, ctx.from.id)}`);
  });

  bot.command("help", (ctx) => ctx.reply(HELP));

  /**
   * In a group: `/watch` (own wishlist) or `/watch wishlist_<id>` — organisers
   * get "X booked Y" here. Refuses if the wishlist owner is in the chat.
   */
  bot.command("watch", async (ctx) => {
    if (!ctx.from) return;
    if (ctx.chat.type === "private") return ctx.reply("Команда /watch работает в групповом чате друзей-организаторов.");
    const ownerId = parseWishlistRef(ctx.match) ?? ctx.from.id;
    const owner = await getUser(db, ownerId);
    if (!owner) return ctx.reply("Не нашёл такой вишлист. Его владелец должен хотя бы раз открыть бота.");

    let ownerInChat: boolean | null = null;
    try {
      const m = await ctx.api.getChatMember(ctx.chat.id, owner.id);
      ownerInChat = !["left", "kicked"].includes(m.status);
    } catch {
      ownerInChat = null; // can't tell (e.g. user never talked to the bot)
    }
    if (ownerInChat) {
      return ctx.reply("Владелец вишлиста состоит в этом чате — уведомления раскрыли бы сюрприз. Создайте отдельный чат без именинника.");
    }

    const wishlist = await ensureWishlist(db, owner.id);
    await db.update(wishlists).set({ notifyChatId: ctx.chat.id }).where(eq(wishlists.id, wishlist.id));
    return ctx.reply(
      `Готово: сюда будут приходить брони и складчины по вишлисту ${displayName(owner)}.` +
        (ownerInChat === null ? "\n⚠️ Проверьте, что именинника нет в этом чате." : ""),
    );
  });

  bot.command("unwatch", async (ctx) => {
    if (!ctx.from || ctx.chat.type === "private") return;
    await db
      .update(wishlists)
      .set({ notifyChatId: null })
      .where(and(eq(wishlists.notifyChatId, ctx.chat.id)));
    return ctx.reply("Уведомления для этого чата отключены.");
  });

  bot.catch((err) => console.error("bot error", err.error));
  return bot;
}
