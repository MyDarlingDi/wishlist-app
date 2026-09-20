import type { NextFunction, Request, Response } from "express";
import type { Config } from "../config.js";
import type { DB } from "../db/client.js";
import type { User } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { upsertUser } from "../services/wishes.js";
import { InitDataError, validateInitData, type TgUser } from "./initData.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Every /api request must carry `Authorization: tma <initData>`.
 * The user row is created/refreshed on the way in.
 */
export function requireAuth(cfg: Config, db: DB) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.header("authorization") ?? "";
      const [scheme, ...rest] = header.split(" ");
      const value = rest.join(" ");

      let tg: TgUser;
      if (scheme === "dev" && cfg.DEV_AUTH === "1" && cfg.NODE_ENV !== "production") {
        const [id, ...name] = value.split(":");
        tg = { id: Number(id), first_name: name.join(":") || "Dev" };
        if (!Number.isSafeInteger(tg.id)) throw new HttpError(401, "unauthorized", { reason: "bad_dev_auth" });
      } else if (scheme === "tma") {
        tg = validateInitData(value, cfg.BOT_TOKEN, { maxAgeSec: cfg.INITDATA_MAX_AGE_SEC }).user;
      } else {
        throw new HttpError(401, "unauthorized", { reason: "no_init_data" });
      }

      req.user = await upsertUser(db, tg);
      next();
    } catch (e) {
      if (e instanceof InitDataError) next(new HttpError(401, "unauthorized", { reason: e.reason }));
      else next(e);
    }
  };
}
