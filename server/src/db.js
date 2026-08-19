import { createClient } from "@libsql/client";
import "dotenv/config";

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error(
    "Не задан TURSO_DATABASE_URL. Для облака создайте бесплатную базу на turso.tech (см. README), " +
      "для локальной разработки можно указать TURSO_DATABASE_URL=file:./data/wishlist.db (без токена)."
  );
}

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

await db.executeMultiple(`
CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  photo_url TEXT,
  bio TEXT,
  birthdate TEXT,
  stars_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  image_url TEXT,
  price REAL,
  currency TEXT,
  site_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  item_id INTEGER PRIMARY KEY,
  booker_id INTEGER NOT NULL,
  booker_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS star_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  from_id INTEGER,
  from_name TEXT,
  amount INTEGER NOT NULL,
  telegram_payment_charge_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- users ----------

export async function upsertUser(u) {
  const existing = await getUser(u.tg_id);
  if (existing) {
    await db.execute({
      sql: `UPDATE users SET first_name=?, last_name=?, username=?, photo_url=?,
            bio=COALESCE(?, bio), birthdate=COALESCE(?, birthdate), updated_at=datetime('now')
            WHERE tg_id=?`,
      args: [u.first_name, u.last_name, u.username, u.photo_url, u.bio, u.birthdate, u.tg_id],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO users (tg_id, first_name, last_name, username, photo_url, bio, birthdate)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [u.tg_id, u.first_name, u.last_name, u.username, u.photo_url, u.bio, u.birthdate],
    });
  }
  return getUser(u.tg_id);
}

export async function getUser(tgId) {
  const r = await db.execute({ sql: "SELECT * FROM users WHERE tg_id = ?", args: [tgId] });
  return r.rows[0] || null;
}

export async function addStars(tgId, amount) {
  await db.execute({
    sql: "UPDATE users SET stars_balance = stars_balance + ?, updated_at = datetime('now') WHERE tg_id = ?",
    args: [amount, tgId],
  });
}

// ---------- items ----------

export async function listItems(ownerId) {
  const r = await db.execute({
    sql: "SELECT * FROM items WHERE owner_id = ? ORDER BY position, id",
    args: [ownerId],
  });
  return r.rows;
}

export async function getItem(id) {
  const r = await db.execute({ sql: "SELECT * FROM items WHERE id = ?", args: [id] });
  return r.rows[0] || null;
}

export async function insertItem(ownerId, data) {
  const r = await db.execute({
    sql: `INSERT INTO items (owner_id, url, title, image_url, price, currency, site_name)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [ownerId, data.url, data.title, data.image_url, data.price, data.currency, data.site_name],
  });
  return getItem(Number(r.lastInsertRowid));
}

export async function updateItem(id, patch) {
  const current = await getItem(id);
  if (!current) return null;
  await db.execute({
    sql: "UPDATE items SET title = ?, price = ?, currency = ?, image_url = ? WHERE id = ?",
    args: [
      patch.title ?? current.title,
      patch.price ?? current.price,
      patch.currency ?? current.currency,
      patch.image_url ?? current.image_url,
      id,
    ],
  });
  return getItem(id);
}

export async function deleteItem(id) {
  await db.execute({ sql: "DELETE FROM bookings WHERE item_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM items WHERE id = ?", args: [id] });
}

// ---------- bookings ----------

export async function listBookingsByOwner(ownerId) {
  const r = await db.execute({
    sql: "SELECT * FROM bookings WHERE item_id IN (SELECT id FROM items WHERE owner_id = ?)",
    args: [ownerId],
  });
  return r.rows;
}

export async function getBooking(itemId) {
  const r = await db.execute({ sql: "SELECT * FROM bookings WHERE item_id = ?", args: [itemId] });
  return r.rows[0] || null;
}

export async function insertBooking(itemId, bookerId, bookerName) {
  await db.execute({
    sql: "INSERT INTO bookings (item_id, booker_id, booker_name) VALUES (?, ?, ?)",
    args: [itemId, bookerId, bookerName],
  });
}

export async function deleteBooking(itemId) {
  await db.execute({ sql: "DELETE FROM bookings WHERE item_id = ?", args: [itemId] });
}
