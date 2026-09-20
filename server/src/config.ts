import { createHmac } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  BOT_TOKEN: z.string().min(20, "BOT_TOKEN is required"),
  BOT_USERNAME: z.string().default("wish_and_gift_bot"),
  /** Mini App URL (Vercel). Also the only allowed CORS origin. */
  WEBAPP_URL: z.string().url(),
  /** Mini App short name registered in BotFather (/newapp). Optional. */
  APP_SHORT_NAME: z.string().optional(),
  /** postgres://… ; unset or `pglite:<dir>` = embedded dev database. */
  DATABASE_URL: z.string().optional(),
  /** Optional override. Default: derived from BOT_TOKEN (see webhookSecret()). */
  WEBHOOK_SECRET: z.string().min(16).regex(/^[A-Za-z0-9_-]+$/).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  VISION_MODEL: z.string().default("claude-opus-5"),
  /** initData older than this is rejected. */
  INITDATA_MAX_AGE_SEC: z.coerce.number().default(24 * 3600),
  /**
   * "1" = on every start, point the Telegram webhook, commands and menu button at this server
   * (its public URL is PUBLIC_URL, or RENDER_EXTERNAL_URL which Render provides). Off by default so
   * that a staging copy can never steal the production bot.
   */
  AUTO_SETUP_BOT: z.enum(["0", "1"]).default("0"),
  PUBLIC_URL: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  /**
   * Local dev only: receive updates by long polling. WARNING: starting polling
   * deletes the bot's webhook, i.e. it disconnects the production server.
   * Use a separate test bot (BotFather → /newbot) for this.
   */
  BOT_POLLING: z.enum(["0", "1"]).default("0"),
  /** Non-production only: accept `Authorization: dev <id>:<name>`. */
  DEV_AUTH: z.enum(["0", "1"]).default("0"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.NODE_ENV === "production") {
    if (cfg.BOT_POLLING === "1") throw new Error("BOT_POLLING must not be enabled in production");
    if (cfg.DEV_AUTH === "1") throw new Error("DEV_AUTH must not be enabled in production");
    if (!cfg.DATABASE_URL?.startsWith("postgres")) throw new Error("DATABASE_URL (postgres) is required in production");
  }
  return cfg;
}

/**
 * Value Telegram echoes in X-Telegram-Bot-Api-Secret-Token on every webhook call.
 * Derived from the bot token, so it never has to be typed anywhere and changes when the token is revoked.
 */
export function webhookSecret(cfg: Pick<Config, "BOT_TOKEN" | "WEBHOOK_SECRET">): string {
  return cfg.WEBHOOK_SECRET ?? createHmac("sha256", cfg.BOT_TOKEN).update("telegram-webhook-secret").digest("base64url");
}
