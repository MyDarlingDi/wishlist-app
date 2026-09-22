import type { Config } from "./config.js";

/** `wishlist_123`, `u123` (links made by the old app) or a bare `123` → 123. */
export function parseWishlistRef(ref: string | undefined | null): number | null {
  const m = /^(?:wishlist_|u)?(\d{1,15})$/.exec((ref ?? "").trim());
  return m ? Number(m[1]) : null;
}

/**
 * Link a friend opens to see someone's wishlist.
 * With a Mini App short name registered in BotFather it opens the app directly,
 * otherwise it opens the bot chat and /start shows an "open" button.
 */
export function shareLink(cfg: { BOT_USERNAME: string; APP_SHORT_NAME?: string }, ownerId: number): string {
  return cfg.APP_SHORT_NAME
    ? `https://t.me/${cfg.BOT_USERNAME}/${cfg.APP_SHORT_NAME}?startapp=wishlist_${ownerId}`
    : `https://t.me/${cfg.BOT_USERNAME}?start=wishlist_${ownerId}`;
}

/** Mini App URL that preselects a wishlist (used by inline web_app buttons, which have no start_param). */
export function webAppUrl(cfg: Pick<Config, "WEBAPP_URL">, ownerId?: number): string {
  const u = new URL(cfg.WEBAPP_URL);
  if (ownerId) u.searchParams.set("wl", String(ownerId));
  return u.toString();
}
