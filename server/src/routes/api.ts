import { eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Config } from "../config.js";
import type { DB } from "../db/client.js";
import { wishImages } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { parseWishlistRef, shareLink } from "../links.js";
import { dataUrlToBuffer, processImage, storeImage } from "../services/images.js";
import { fetchLinkPreview, siteNameFromUrl } from "../services/scrape.js";
import { safeGet } from "../services/ssrf.js";
import type { Notifier } from "../services/notify.js";
import { rateLimit } from "../services/rateLimit.js";
import type { Vision } from "../services/vision.js";
import * as svc from "../services/wishes.js";

export interface ApiDeps {
  cfg: Config;
  db: DB;
  notifier: Notifier;
  vision: Vision | null;
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const ah = (fn: Handler): RequestHandler => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "http(s) only");
const price = z.number().int().min(1).max(100_000_000);
const currency = z.enum(["RUB", "USD", "EUR", "KZT", "BYN", "UAH"]);

const WishBody = z.object({
  title: z.string().trim().min(1).max(200),
  url: httpUrl.nullish(),
  price: price.nullish(),
  currency: currency.optional(),
  image_id: z.string().uuid().nullish(),
  is_group_gift: z.boolean().optional(),
});
const WishPatch = WishBody.partial();

const wishId = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "bad_request");
  return id;
};

export function apiRouter({ cfg, db, notifier, vision }: ApiDeps): Router {
  const r = Router();
  const me = (req: Request) => req.user!;

  const publicUser = (u: { id: number; firstName: string; lastName: string | null; username: string | null; avatarUrl: string | null }) => ({
    id: u.id,
    first_name: u.firstName,
    last_name: u.lastName,
    username: u.username,
    photo_url: u.avatarUrl,
  });

  r.get(
    "/me",
    ah(async (req, res) => {
      const user = me(req);
      const wishlist = await svc.ensureWishlist(db, user.id);
      res.json({ ...publicUser(user), wishlist_id: wishlist.id, share_link: shareLink(cfg, user.id) });
    }),
  );

  // ---------------------------------------------------------------- wishes

  r.get(
    "/wishes",
    ah(async (req, res) => {
      const raw = req.query.owner;
      const ownerId = raw === undefined ? me(req).id : parseWishlistRef(String(raw));
      if (!ownerId) throw new HttpError(400, "bad_request");
      const owner = await svc.getUser(db, ownerId);
      if (!owner) throw new HttpError(404, "owner_not_found");
      const wishlist = await svc.ensureWishlist(db, owner.id);
      const items = await svc.listWishes(db, wishlist, me(req).id);
      res.json({
        owner: publicUser(owner),
        is_owner: owner.id === me(req).id,
        wishlist: { id: wishlist.id, title: wishlist.title },
        items,
      });
    }),
  );

  const toInput = (b: z.infer<typeof WishPatch>): Partial<svc.WishInput> => ({
    title: b.title,
    url: b.url,
    price: b.price,
    currency: b.currency,
    imageId: b.image_id,
    isGroupGift: b.is_group_gift,
    ...(b.url !== undefined ? { siteName: b.url ? siteNameFromUrl(b.url) : null } : {}),
  });

  r.post(
    "/wishes",
    ah(async (req, res) => {
      const body = WishBody.parse(req.body);
      const wish = await svc.createWish(db, me(req).id, toInput(body) as svc.WishInput);
      res.status(201).json({ item: await svc.getWishView(db, wish.id, me(req).id) });
    }),
  );

  r.patch(
    "/wishes/:id",
    ah(async (req, res) => {
      const wish = await svc.updateWish(db, me(req).id, wishId(req), toInput(WishPatch.parse(req.body)));
      res.json({ item: await svc.getWishView(db, wish.id, me(req).id) });
    }),
  );

  r.delete(
    "/wishes/:id",
    ah(async (req, res) => {
      await svc.deleteWish(db, me(req).id, wishId(req));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- secret booking

  r.post(
    "/wishes/:id/book",
    ah(async (req, res) => {
      const id = wishId(req);
      const { ctx, created } = await svc.bookWish(db, me(req).id, id);
      if (created) notifier.booked(ctx, me(req));
      res.json({ item: await svc.getWishView(db, id, me(req).id) });
    }),
  );

  r.delete(
    "/wishes/:id/book",
    ah(async (req, res) => {
      const id = wishId(req);
      notifier.unbooked(await svc.unbookWish(db, me(req).id, id), me(req));
      res.json({ item: await svc.getWishView(db, id, me(req).id) });
    }),
  );

  // ---------------------------------------------------------------- group gifts

  r.post(
    "/wishes/:id/contribute",
    ah(async (req, res) => {
      const id = wishId(req);
      const { amount } = z.object({ amount: price }).parse(req.body);
      const { ctx, collected } = await svc.contribute(db, me(req).id, id, amount);
      notifier.contributed(ctx, me(req), amount, collected);
      res.json({ item: await svc.getWishView(db, id, me(req).id) });
    }),
  );

  r.delete(
    "/wishes/:id/contribute",
    ah(async (req, res) => {
      const id = wishId(req);
      notifier.withdrew(await svc.withdrawContribution(db, me(req).id, id), me(req));
      res.json({ item: await svc.getWishView(db, id, me(req).id) });
    }),
  );

  // ---------------------------------------------------------------- images & parsing

  const imageResult = async (img: Awaited<ReturnType<typeof processImage>>) => {
    const id = await storeImage(db, img);
    return { image_id: id, image_url: svc.imageUrl(id), image_bg: img.bg };
  };

  r.post(
    "/images",
    rateLimit(60, 3600_000),
    ah(async (req, res) => {
      const { image } = z.object({ image: z.string() }).parse(req.body);
      res.status(201).json(await imageResult(await processImage(dataUrlToBuffer(image))));
    }),
  );

  /** Screenshot → title, price and the product photo cut out of it (Claude vision). */
  r.post(
    "/parse/screenshot",
    rateLimit(20, 3600_000),
    ah(async (req, res) => {
      if (!vision) throw new HttpError(503, "vision_not_configured");
      const { image } = z.object({ image: z.string() }).parse(req.body);
      const source = dataUrlToBuffer(image);
      // The model gets a large copy (text on a tall phone screenshot must stay legible);
      // the box it returns is relative, so it applies to the original as well.
      const forModel = await processImage(source, null, 1568);
      let found;
      try {
        found = await vision.extract(forModel.data);
      } catch (e) {
        console.error("vision failed", e);
        throw new HttpError(502, "vision_failed");
      }
      const crop = found.box ? await processImage(source, found.box) : null;
      const whole = await processImage(source);
      const cropped = !!crop?.cropped;
      res.json({
        title: found.title,
        price: found.price,
        currency: found.currency,
        ...(await imageResult(cropped ? crop! : whole)),
        cropped,
        // Lets the UI offer "use the whole screenshot" when the automatic crop is off.
        screenshot: cropped ? await imageResult(whole) : null,
      });
    }),
  );

  /** Link → OpenGraph / JSON-LD data. Often empty for big marketplaces (bot protection). */
  r.post(
    "/parse/link",
    rateLimit(30, 3600_000),
    ah(async (req, res) => {
      const { url } = z.object({ url: httpUrl }).parse(req.body);
      let preview;
      try {
        preview = await fetchLinkPreview(url);
      } catch (e) {
        if (e instanceof HttpError && e.status < 500) throw e;
        preview = { title: null, price: null, currency: null, image_url: null, site_name: siteNameFromUrl(url) };
      }
      let photo: Awaited<ReturnType<typeof imageResult>> | null = null;
      if (preview.image_url) {
        try {
          const got = await safeGet(preview.image_url, { maxBytes: 8 * 1024 * 1024, headers: { "user-agent": "Mozilla/5.0" } });
          if (got.status < 400) photo = await imageResult(await processImage(got.body));
        } catch {
          photo = null;
        }
      }
      res.json({
        title: preview.title,
        price: preview.price,
        currency: preview.currency ?? "RUB",
        site_name: preview.site_name,
        image_id: photo?.image_id ?? null,
        image_url: photo?.image_url ?? null,
        image_bg: photo?.image_bg ?? null,
      });
    }),
  );

  return r;
}

/** Public: <img> tags can't send the Authorization header. Ids are random UUIDs. */
export function imageRouter(db: DB): Router {
  const r = Router();
  r.get(
    "/images/:id",
    ah(async (req, res) => {
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found");
      const [row] = await db.select().from(wishImages).where(eq(wishImages.id, id));
      if (!row) throw new HttpError(404, "not_found");
      // setHeader, not res.set(): Express would append "; charset=utf-8" to the image type.
      res.setHeader("Content-Type", row.mime);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.end(row.data);
    }),
  );
  return r;
}
