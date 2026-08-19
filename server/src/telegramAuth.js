import crypto from "node:crypto";

/**
 * Проверяет подпись initData, присланного Telegram Mini App,
 * по алгоритму из официальной документации:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData) return { ok: false, reason: "no_init_data" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "no_hash" };
  params.delete("hash");

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) {
    return { ok: false, reason: "bad_signature" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  const age = Date.now() / 1000 - authDate;
  if (age > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }

  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    user = null;
  }

  const startParam = params.get("start_param") || null;

  return { ok: true, user, startParam };
}

/** Express-мидлвар: требует заголовок Authorization: tma <initData> */
export function requireTelegramAuth(botToken) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const initData = authHeader.startsWith("tma ") ? authHeader.slice(4) : null;
    const result = verifyInitData(initData, botToken);
    if (!result.ok) {
      return res.status(401).json({ error: "unauthorized", reason: result.reason });
    }
    req.tgUser = result.user;
    req.startParam = result.startParam;
    next();
  };
}
