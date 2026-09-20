import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { TgUser } from "../auth/initData.js";
import type { DB } from "../db/client.js";
import {
  bookings,
  contributions,
  users,
  wishImages,
  wishes,
  wishlists,
  type User,
  type Wish,
  type Wishlist,
} from "../db/schema.js";
import { HttpError } from "../errors.js";

export const imageUrl = (id: string | null) => (id ? `/api/images/${id}` : null);

// ---------------------------------------------------------------- users

/** Create the user on first sight, refresh name/avatar afterwards. */
export async function upsertUser(db: DB, tg: TgUser): Promise<User> {
  const values = {
    username: tg.username ?? null,
    firstName: tg.first_name,
    lastName: tg.last_name ?? null,
    avatarUrl: tg.photo_url ?? null,
  };
  const [row] = await db
    .insert(users)
    .values({ id: tg.id, ...values })
    .onConflictDoUpdate({ target: users.id, set: { ...values, updatedAt: new Date() } })
    .returning();
  return row!;
}

export async function getUser(db: DB, id: number): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

export async function ensureWishlist(db: DB, ownerId: number): Promise<Wishlist> {
  await db.insert(wishlists).values({ ownerId }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(wishlists)
    .where(and(eq(wishlists.ownerId, ownerId), eq(wishlists.isDefault, true)));
  return row!;
}

export const displayName = (u: Pick<User, "firstName" | "lastName" | "username">) =>
  [u.firstName, u.lastName].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : "Кто-то");

// ---------------------------------------------------------------- views

export interface WishView {
  id: number;
  title: string;
  url: string | null;
  price: number | null;
  currency: string;
  site_name: string | null;
  image_url: string | null;
  image_bg: string | null;
  is_group_gift: boolean;
  created_at: Date;
  /** Guest-only fields — never present when the owner looks at their own list. */
  booked?: boolean;
  booked_by_me?: boolean;
  collected?: number;
  contributors?: number;
  my_contribution?: number;
  remaining?: number | null;
}

type WishRow = Wish & { bg: string | null };

async function loadWishRows(db: DB, where: ReturnType<typeof eq>): Promise<WishRow[]> {
  const rows = await db
    .select({ wish: wishes, bg: wishImages.bg })
    .from(wishes)
    .leftJoin(wishImages, eq(wishes.imageId, wishImages.id))
    .where(where)
    .orderBy(desc(wishes.createdAt), desc(wishes.id));
  return rows.map((r) => ({ ...r.wish, bg: r.bg }));
}

/**
 * Turns rows into API objects. The secret-booking rule lives here:
 * the owner gets no booking/contribution data at all, so a surprise
 * cannot leak through any endpoint that goes through this function.
 */
async function toViews(db: DB, rows: WishRow[], viewerId: number, ownerId: number): Promise<WishView[]> {
  const base = (w: WishRow): WishView => ({
    id: w.id,
    title: w.title,
    url: w.url,
    price: w.price,
    currency: w.currency,
    site_name: w.siteName,
    image_url: imageUrl(w.imageId),
    image_bg: w.bg,
    is_group_gift: w.isGroupGift,
    created_at: w.createdAt,
  });
  if (viewerId === ownerId || rows.length === 0) return rows.map(base);

  const ids = rows.map((r) => r.id);
  const bookingRows = await db.select().from(bookings).where(inArray(bookings.wishId, ids));
  const contribRows = await db.select().from(contributions).where(inArray(contributions.wishId, ids));

  return rows.map((w) => {
    const booking = bookingRows.find((b) => b.wishId === w.id);
    const all = contribRows.filter((c) => c.wishId === w.id);
    const collected = all.reduce((s, c) => s + c.amount, 0);
    return {
      ...base(w),
      booked: !!booking,
      booked_by_me: booking?.userId === viewerId,
      collected,
      contributors: new Set(all.map((c) => c.userId)).size,
      my_contribution: all.filter((c) => c.userId === viewerId).reduce((s, c) => s + c.amount, 0),
      remaining: w.isGroupGift && w.price ? Math.max(0, w.price - collected) : null,
    };
  });
}

export async function listWishes(db: DB, wishlist: Wishlist, viewerId: number): Promise<WishView[]> {
  const rows = await loadWishRows(db, eq(wishes.wishlistId, wishlist.id));
  return toViews(db, rows, viewerId, wishlist.ownerId);
}

export async function getWishView(db: DB, wishId: number, viewerId: number): Promise<WishView> {
  const ctx = await getWishContext(db, wishId);
  const rows = await loadWishRows(db, eq(wishes.id, wishId));
  return (await toViews(db, rows, viewerId, ctx.wishlist.ownerId))[0]!;
}

// ---------------------------------------------------------------- CRUD (owner)

export interface WishInput {
  title: string;
  url?: string | null;
  price?: number | null;
  currency?: string;
  siteName?: string | null;
  imageId?: string | null;
  isGroupGift?: boolean;
}

function assertGroupGiftHasPrice(w: { isGroupGift: boolean; price: number | null }) {
  if (w.isGroupGift && !w.price) throw new HttpError(400, "group_gift_needs_price");
}

export async function createWish(db: DB, ownerId: number, input: WishInput): Promise<Wish> {
  const wishlist = await ensureWishlist(db, ownerId);
  const draft = { isGroupGift: input.isGroupGift ?? false, price: input.price ?? null };
  assertGroupGiftHasPrice(draft);
  const [row] = await db
    .insert(wishes)
    .values({
      wishlistId: wishlist.id,
      title: input.title,
      url: input.url ?? null,
      price: draft.price,
      currency: input.currency ?? "RUB",
      siteName: input.siteName ?? null,
      imageId: input.imageId ?? null,
      isGroupGift: draft.isGroupGift,
    })
    .returning();
  return row!;
}

export interface WishContext {
  wish: Wish;
  wishlist: Wishlist;
  owner: User;
}

export async function getWishContext(db: DB, wishId: number): Promise<WishContext> {
  const [row] = await db
    .select({ wish: wishes, wishlist: wishlists, owner: users })
    .from(wishes)
    .innerJoin(wishlists, eq(wishes.wishlistId, wishlists.id))
    .innerJoin(users, eq(wishlists.ownerId, users.id))
    .where(eq(wishes.id, wishId));
  if (!row) throw new HttpError(404, "wish_not_found");
  return row;
}

async function getOwnedWish(db: DB, ownerId: number, wishId: number): Promise<WishContext> {
  const ctx = await getWishContext(db, wishId);
  // 404 rather than 403: don't confirm that someone else's wish id exists.
  if (ctx.wishlist.ownerId !== ownerId) throw new HttpError(404, "wish_not_found");
  return ctx;
}

export async function updateWish(db: DB, ownerId: number, wishId: number, patch: Partial<WishInput>): Promise<Wish> {
  const { wish } = await getOwnedWish(db, ownerId, wishId);
  const next = {
    title: patch.title ?? wish.title,
    url: patch.url !== undefined ? patch.url : wish.url,
    price: patch.price !== undefined ? patch.price : wish.price,
    currency: patch.currency ?? wish.currency,
    siteName: patch.siteName !== undefined ? patch.siteName : wish.siteName,
    imageId: patch.imageId !== undefined ? patch.imageId : wish.imageId,
    isGroupGift: patch.isGroupGift ?? wish.isGroupGift,
  };
  assertGroupGiftHasPrice(next);
  const [row] = await db
    .update(wishes)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(wishes.id, wishId))
    .returning();
  return row!;
}

export async function deleteWish(db: DB, ownerId: number, wishId: number): Promise<void> {
  await getOwnedWish(db, ownerId, wishId);
  await db.delete(wishes).where(eq(wishes.id, wishId));
}

// ---------------------------------------------------------------- guests

function assertGuest(ctx: WishContext, userId: number) {
  if (ctx.wishlist.ownerId === userId) throw new HttpError(403, "own_wish");
}

/** `created` is false when the same person books again (idempotent, no new notification). */
export async function bookWish(db: DB, userId: number, wishId: number): Promise<{ ctx: WishContext; created: boolean }> {
  const ctx = await getWishContext(db, wishId);
  assertGuest(ctx, userId);
  if (ctx.wish.isGroupGift) throw new HttpError(409, "group_gift");

  const inserted = await db.insert(bookings).values({ wishId, userId }).onConflictDoNothing().returning();
  if (inserted.length === 0) {
    const [existing] = await db.select().from(bookings).where(eq(bookings.wishId, wishId));
    if (existing?.userId !== userId) throw new HttpError(409, "already_booked");
    return { ctx, created: false };
  }
  return { ctx, created: true };
}

export async function unbookWish(db: DB, userId: number, wishId: number): Promise<WishContext> {
  const ctx = await getWishContext(db, wishId);
  assertGuest(ctx, userId);
  const deleted = await db
    .delete(bookings)
    .where(and(eq(bookings.wishId, wishId), eq(bookings.userId, userId)))
    .returning();
  if (deleted.length === 0) throw new HttpError(404, "not_booked");
  return ctx;
}

export async function contribute(
  db: DB,
  userId: number,
  wishId: number,
  amount: number,
): Promise<{ ctx: WishContext; collected: number }> {
  return db.transaction(async (tx) => {
    // Lock the wish so two simultaneous contributions cannot overshoot the target.
    const [locked] = await tx.select({ id: wishes.id }).from(wishes).where(eq(wishes.id, wishId)).for("update");
    if (!locked) throw new HttpError(404, "wish_not_found");
    const ctx = await getWishContext(tx as unknown as DB, wishId);
    assertGuest(ctx, userId);
    if (!ctx.wish.isGroupGift || !ctx.wish.price) throw new HttpError(409, "not_group_gift");

    const [{ total }] = (await tx
      .select({ total: sql<number>`coalesce(sum(${contributions.amount}), 0)::int` })
      .from(contributions)
      .where(eq(contributions.wishId, wishId))) as [{ total: number }];
    const remaining = ctx.wish.price - total;
    if (remaining <= 0) throw new HttpError(409, "fully_funded");
    if (amount > remaining) throw new HttpError(400, "exceeds_remaining", { remaining });

    await tx.insert(contributions).values({ wishId, userId, amount });
    return { ctx, collected: total + amount };
  });
}

export async function withdrawContribution(db: DB, userId: number, wishId: number): Promise<WishContext> {
  const ctx = await getWishContext(db, wishId);
  assertGuest(ctx, userId);
  const deleted = await db
    .delete(contributions)
    .where(and(eq(contributions.wishId, wishId), eq(contributions.userId, userId)))
    .returning();
  if (deleted.length === 0) throw new HttpError(404, "no_contribution");
  return ctx;
}
