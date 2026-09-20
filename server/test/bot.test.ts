import { eq } from "drizzle-orm";
import type { Update } from "grammy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBot } from "../src/bot/bot.js";
import { wishlists } from "../src/db/schema.js";
import { ensureWishlist, upsertUser } from "../src/services/wishes.js";
import { cfg, makeApp } from "./helpers.js";

type Call = { method: string; payload: Record<string, any> };
let calls: Call[];
let bot: ReturnType<typeof createBot>;
let t: Awaited<ReturnType<typeof makeApp>>;
let chatMemberStatus = "left";

beforeAll(async () => {
  t = await makeApp();
  bot = createBot(cfg, t.db);
  bot.botInfo = { id: 1, is_bot: true, first_name: "b", username: "wish_and_gift_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false } as never;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, any> });
    if (method === "getChatMember") return { ok: true, result: { status: chatMemberStatus } } as never;
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1 } } } as never;
  });
});
afterAll(() => t.close());

let updateId = 0;
async function say(text: string, from: { id: number; first_name: string }, chat: { id: number; type: "private" | "supergroup" }) {
  calls = [];
  const cmdLen = text.split(" ")[0]!.length;
  await bot.handleUpdate({
    update_id: ++updateId,
    message: { message_id: updateId, date: 0, chat, from: { ...from, is_bot: false }, text, entities: [{ type: "bot_command", offset: 0, length: cmdLen }] },
  } as Update);
  return calls;
}
const sent = () => calls.find((c) => c.method === "sendMessage")!.payload;
const button = () => sent().reply_markup?.inline_keyboard?.[0]?.[0];

const olya = { id: 1001, first_name: "Оля" };
const anya = { id: 2002, first_name: "Аня" };

describe("/start", () => {
  it("greets and offers a web_app button for the user's own wishlist, and registers the user", async () => {
    await say("/start", olya, { id: olya.id, type: "private" });
    expect(sent().text).toContain("вишлист");
    expect(button()).toMatchObject({ text: "🎁 Мой вишлист", web_app: { url: "https://wishlist-app-opal.vercel.app/" } });
    const me = await ensureWishlist(t.db, olya.id); // exists → the user row was created by /start
    expect(me.ownerId).toBe(olya.id);
  });

  it("opens someone else's wishlist from a deep link", async () => {
    await say("/start wishlist_1001", anya, { id: anya.id, type: "private" });
    expect(sent().text).toContain("Оля");
    expect(button().web_app.url).toBe("https://wishlist-app-opal.vercel.app/?wl=1001");
  });

  it("understands links produced by the old app (u<id>) and tolerates unknown owners", async () => {
    await say("/start u1001", anya, { id: anya.id, type: "private" });
    expect(button().web_app.url).toContain("wl=1001");
    await say("/start wishlist_777777", anya, { id: anya.id, type: "private" });
    expect(sent().text).toContain("не найден");
    expect(button()).toBeUndefined();
  });

  it("does not hand out web_app buttons in groups (they only work in private chats)", async () => {
    await say("/start", anya, { id: -500, type: "supergroup" });
    expect(button()).toBeUndefined();
  });
});

describe("/share", () => {
  it("returns the link to the caller's own wishlist", async () => {
    await say("/share", olya, { id: olya.id, type: "private" });
    expect(sent().text).toContain("https://t.me/wish_and_gift_bot?start=wishlist_1001");
  });
});

describe("/watch in a group of organisers", () => {
  const group = { id: -500, type: "supergroup" as const };

  it("links the group to a wishlist so bookings are announced there", async () => {
    await upsertUser(t.db, { id: 1001, first_name: "Оля" });
    chatMemberStatus = "left"; // the birthday person is not in the chat
    await say("/watch wishlist_1001", anya, group);
    expect(sent().text).toContain("Готово");
    const [row] = await t.db.select().from(wishlists).where(eq(wishlists.ownerId, 1001));
    expect(row!.notifyChatId).toBe(-500);
  });

  it("refuses when the wishlist owner is in the chat (it would spoil the surprise)", async () => {
    const other = await ensureWishlist(t.db, (await upsertUser(t.db, { id: 4004, first_name: "Витя" })).id);
    chatMemberStatus = "member";
    await say("/watch wishlist_4004", anya, { id: -600, type: "supergroup" });
    expect(sent().text).toContain("состоит в этом чате");
    const [row] = await t.db.select().from(wishlists).where(eq(wishlists.id, other.id));
    expect(row!.notifyChatId).toBeNull();
  });

  it("/unwatch turns the notifications off; /watch is refused in private chats", async () => {
    await say("/unwatch", anya, group);
    const [row] = await t.db.select().from(wishlists).where(eq(wishlists.ownerId, 1001));
    expect(row!.notifyChatId).toBeNull();
    await say("/watch", anya, { id: anya.id, type: "private" });
    expect(sent().text).toContain("групповом чате");
  });
});
