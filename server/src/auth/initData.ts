import { createHmac, timingSafeEqual } from "node:crypto";

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface ValidInitData {
  user: TgUser;
  authDate: number;
  startParam?: string;
}

export type InitDataFailure = "missing" | "no_hash" | "bad_hash" | "no_auth_date" | "expired" | "no_user" | "bad_user";

export class InitDataError extends Error {
  constructor(public reason: InitDataFailure) {
    super(`invalid initData: ${reason}`);
  }
}

/**
 * Validates Telegram Mini App `initData` (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *   secret_key = HMAC_SHA256(key = "WebAppData", msg = BOT_TOKEN)
 *   hash       = hex(HMAC_SHA256(key = secret_key, msg = data_check_string))
 * where data_check_string is every received field except `hash`, as
 * `key=value`, sorted alphabetically by key, joined with "\n".
 */
export function validateInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec?: number; now?: number } = {},
): ValidInitData {
  if (!initData) throw new InitDataError("missing");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new InitDataError("no_hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InitDataError("bad_hash");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) throw new InitDataError("no_auth_date");
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (opts.maxAgeSec !== undefined && now - authDate > opts.maxAgeSec) throw new InitDataError("expired");

  const rawUser = params.get("user");
  if (!rawUser) throw new InitDataError("no_user");
  let user: TgUser;
  try {
    user = JSON.parse(rawUser) as TgUser;
  } catch {
    throw new InitDataError("bad_user");
  }
  if (!Number.isSafeInteger(user.id) || typeof user.first_name !== "string") throw new InitDataError("bad_user");

  return { user, authDate, startParam: params.get("start_param") ?? undefined };
}
