import type { User } from "../db/schema.js";
import { displayName, type WishContext } from "./wishes.js";

export interface Notifier {
  booked(ctx: WishContext, who: User): void;
  unbooked(ctx: WishContext, who: User): void;
  contributed(ctx: WishContext, who: User, amount: number, collected: number): void;
  withdrew(ctx: WishContext, who: User): void;
}

export type SendMessage = (chatId: number, text: string) => Promise<unknown>;

const money = (n: number, cur: string) => `${n.toLocaleString("ru-RU")} ${cur === "USD" ? "$" : cur === "EUR" ? "€" : "₽"}`;

/**
 * Sends "who booked what" to the wishlist's organisers chat — never to the
 * owner (their private chat id equals their user id), and always as plain
 * text so wish titles can't inject markup. Failures only get logged.
 */
export function createNotifier(send: SendMessage | null, log: (msg: string, err?: unknown) => void = console.error): Notifier {
  const push = (ctx: WishContext, text: string) => {
    const chat = ctx.wishlist.notifyChatId;
    if (!send || !chat || chat === ctx.owner.id) return;
    send(chat, `${text}\n\nВишлист: ${displayName(ctx.owner)}. Именинник этого не видит 🤫`).catch((e) => log("notify failed", e));
  };
  return {
    booked: (ctx, who) => push(ctx, `🎁 Бронь: «${ctx.wish.title}» — ${displayName(who)}`),
    unbooked: (ctx, who) => push(ctx, `↩️ Бронь снята: «${ctx.wish.title}» — ${displayName(who)}`),
    contributed: (ctx, who, amount, collected) =>
      push(
        ctx,
        `💸 Складчина «${ctx.wish.title}»: ${displayName(who)} +${money(amount, ctx.wish.currency)}` +
          (ctx.wish.price ? `\nСобрано ${money(collected, ctx.wish.currency)} из ${money(ctx.wish.price, ctx.wish.currency)}` : ""),
      ),
    withdrew: (ctx, who) => push(ctx, `↩️ Складчина «${ctx.wish.title}»: ${displayName(who)} забрал(а) свой взнос`),
  };
}
