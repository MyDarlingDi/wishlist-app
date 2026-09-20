import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const tgId = (name: string) => bigint(name, { mode: "number" });

/** Users. `id` is the Telegram user id, so `wishlist_<id>` links are stable. */
export const users = pgTable("users", {
  id: tgId("id").primaryKey(),
  username: text("username"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A user can have several wishlists; the app currently uses the default one.
 * `notifyChatId` is a group chat of friends/organisers that gets booking
 * notifications (never the owner).
 */
export const wishlists = pgTable(
  "wishlists",
  {
    id: serial("id").primaryKey(),
    ownerId: tgId("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Мой вишлист"),
    isDefault: boolean("is_default").notNull().default(true),
    notifyChatId: tgId("notify_chat_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wishlists_owner_idx").on(t.ownerId),
    uniqueIndex("wishlists_one_default_per_owner")
      .on(t.ownerId)
      .where(sql`${t.isDefault}`),
  ],
);

/** Normalised product photos, served from GET /api/images/:id. */
export const wishImages = pgTable("wish_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  data: bytea("data").notNull(),
  mime: text("mime").notNull().default("image/jpeg"),
  /** Edge colour of the picture, used as the frame background. */
  bg: text("bg"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wishes = pgTable(
  "wishes",
  {
    id: serial("id").primaryKey(),
    wishlistId: integer("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url"),
    /** Whole units of `currency` (roubles, not kopecks). */
    price: integer("price"),
    currency: text("currency").notNull().default("RUB"),
    siteName: text("site_name"),
    imageId: uuid("image_id").references(() => wishImages.id, { onDelete: "set null" }),
    /** True = split between several people (needs `price` as the target). */
    isGroupGift: boolean("is_group_gift").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wishes_wishlist_idx").on(t.wishlistId)],
);

/** Secret reservation: at most one booking per wish. Hidden from the owner. */
export const bookings = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    wishId: integer("wish_id")
      .notNull()
      .references(() => wishes.id, { onDelete: "cascade" }),
    userId: tgId("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bookings_one_per_wish").on(t.wishId)],
);

/** Shares of a group gift. Hidden from the owner. */
export const contributions = pgTable(
  "contributions",
  {
    id: serial("id").primaryKey(),
    wishId: integer("wish_id")
      .notNull()
      .references(() => wishes.id, { onDelete: "cascade" }),
    userId: tgId("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contributions_wish_idx").on(t.wishId)],
);

export type User = typeof users.$inferSelect;
export type Wishlist = typeof wishlists.$inferSelect;
export type Wish = typeof wishes.$inferSelect;
