import { createHmac } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { connectDb } from "../src/db/client.js";
import type { Notifier } from "../src/services/notify.js";
import type { Vision } from "../src/services/vision.js";

export const BOT_TOKEN = "123456:TEST-TOKEN-not-a-real-one-abcdefghij";

export function buildInitData(
  user: { id: number; first_name: string; username?: string },
  opts: { token?: string; authDate?: number; extra?: Record<string, string> } = {},
): string {
  const params: Record<string, string> = {
    auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: "AAH-test",
    user: JSON.stringify(user),
    ...opts.extra,
  };
  const check = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(opts.token ?? BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

export const tma = (user: { id: number; first_name: string }) => `tma ${buildInitData(user)}`;

export const cfg = loadConfig({
  NODE_ENV: "test",
  BOT_TOKEN,
  WEBAPP_URL: "https://wishlist-app-opal.vercel.app/",
});

export function recordingNotifier() {
  const calls: string[] = [];
  const notifier: Notifier = {
    booked: (c, w) => void calls.push(`booked:${c.wish.id}:${w.id}`),
    unbooked: (c, w) => void calls.push(`unbooked:${c.wish.id}:${w.id}`),
    contributed: (c, w, a, col) => void calls.push(`contributed:${c.wish.id}:${w.id}:${a}:${col}`),
    withdrew: (c, w) => void calls.push(`withdrew:${c.wish.id}:${w.id}`),
  };
  return { notifier, calls };
}

export async function makeApp(vision: Vision | null = null) {
  const handle = await connectDb(process.env.TEST_DATABASE_URL);
  const { notifier, calls } = recordingNotifier();
  const app = createApp({ cfg, db: handle.db, notifier, vision });
  return { app, db: handle.db, calls, close: handle.close };
}

export async function pngDataUrl(width = 400, height = 300, color = "#ff0000") {
  const buf = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}
