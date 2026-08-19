import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const dbPath = process.env.DB_PATH || "./data/wishlist.db";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(tg_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  item_id INTEGER PRIMARY KEY,
  booker_id INTEGER NOT NULL,
  booker_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id)
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

export function upsertUser(u) {
  const existing = db.prepare("SELECT tg_id FROM users WHERE tg_id = ?").get(u.tg_id);
  if (existing) {
    db.prepare(
      `UPDATE users SET first_name=?, last_name=?, username=?, photo_url=?,
       bio=COALESCE(?, bio), birthdate=COALESCE(?, birthdate), updated_at=datetime('now')
       WHERE tg_id=?`
    ).run(u.first_name, u.last_name, u.username, u.photo_url, u.bio, u.birthdate, u.tg_id);
  } else {
    db.prepare(
      `INSERT INTO users (tg_id, first_name, last_name, username, photo_url, bio, birthdate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(u.tg_id, u.first_name, u.last_name, u.username, u.photo_url, u.bio, u.birthdate);
  }
  return db.prepare("SELECT * FROM users WHERE tg_id = ?").get(u.tg_id);
}

export function getUser(tgId) {
  return db.prepare("SELECT * FROM users WHERE tg_id = ?").get(tgId);
}

export function addStars(tgId, amount) {
  db.prepare(
    "UPDATE users SET stars_balance = stars_balance + ?, updated_at = datetime('now') WHERE tg_id = ?"
  ).run(amount, tgId);
}
