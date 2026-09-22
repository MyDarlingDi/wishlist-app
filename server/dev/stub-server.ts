/**
 * Local demo API for looking at the UI without Telegram or an Anthropic key:
 *   npx tsx dev/stub-server.ts          (embedded Postgres, DEV_AUTH, fake screenshot recogniser)
 * NOT used in production.
 */
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { connectDb } from "../src/db/client.js";
import { contributions, bookings } from "../src/db/schema.js";
import { processImage, storeImage } from "../src/services/images.js";
import { createNotifier } from "../src/services/notify.js";
import { createWish, ensureWishlist, upsertUser } from "../src/services/wishes.js";

const cfg = loadConfig({ NODE_ENV: "development", DEV_AUTH: "1", BOT_TOKEN: "123456:TEST-TOKEN-not-a-real-one-abcdefghij", WEBAPP_URL: "http://localhost:5173" });
const { db } = await connectDb();

const svg = (w: number, h: number, bg: string, body: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`)).png().toBuffer();

// Deliberately awkward shapes: tall bottle on white, wide sofa on beige, lifestyle photo with busy background, tiny icon-like image.
const pics = {
  bottle: await svg(300, 900, "#ffffff", `<rect x="100" y="80" width="100" height="740" rx="40" fill="#2f6fb0"/><rect x="125" y="30" width="50" height="70" rx="10" fill="#222"/>`),
  sofa: await svg(1200, 400, "#efe6d8", `<rect x="80" y="120" width="1040" height="220" rx="60" fill="#8b5e3c"/><rect x="40" y="180" width="120" height="200" rx="40" fill="#6d4630"/><rect x="1040" y="180" width="120" height="200" rx="40" fill="#6d4630"/>`),
  lifestyle: await svg(800, 800, "#3a6b4a", `<circle cx="400" cy="400" r="260" fill="#f2c94c"/><rect x="330" y="300" width="140" height="300" rx="20" fill="#fff"/>`),
  tiny: await svg(120, 120, "#ffffff", `<circle cx="60" cy="60" r="40" fill="#e8425b"/>`),
};
const store = async (b: Buffer) => storeImage(db, await processImage(b));

const owner = await upsertUser(db, { id: 1, first_name: "Оля", last_name: "Иванова" });
await upsertUser(db, { id: 2, first_name: "Аня" });
await ensureWishlist(db, owner.id);
const w = (title: string, image: Buffer | null, extra: Record<string, unknown> = {}) =>
  (async () => createWish(db, owner.id, { title, url: "https://www.ozon.ru/product/1", siteName: "Ozon", imageId: image ? await store(image) : null, ...extra }))();

const bottle = await w("Спортивная бутылка Nike Hyperfuel 700 мл", pics.bottle, { price: 1290 });
const sofa = await w("Диван двухместный с подушками", pics.sofa, { price: 48990, isGroupGift: true });
await w("Настольная лампа, тёплый свет", pics.lifestyle, { price: 2490 });
await w("Наклейка", pics.tiny, { price: 190 });
await w("Подарок без фото и без цены", null);
await db.insert(bookings).values({ wishId: bottle.id, userId: 2 });
await db.insert(contributions).values({ wishId: sofa.id, userId: 2, amount: 12000 });

const app = createApp({
  cfg,
  db,
  notifier: createNotifier(null),
  vision: {
    // Pretends the model found "Кроссовки" and the product photo in the middle of the screenshot.
    extract: async () => {
      await new Promise((r) => setTimeout(r, 900));
      return { title: "Кроссовки Nike Air Max 90", price: 12990, currency: "RUB", box: { x: 0.2, y: 0.15, width: 0.6, height: 0.45 } };
    },
  },
});
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`stub API on :${port}  (users: 1 = owner Оля with data, 2 = guest Аня, ?devuser=N for others)`));
