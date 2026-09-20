import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../errors.js";

/** Fixed-window per-user limiter (in memory — fine for a single instance). Guards the paid/expensive endpoints. */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<number, { count: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.user!.id;
    const now = Date.now();
    const cur = hits.get(key);
    if (!cur || cur.reset <= now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++cur.count > max) return next(new HttpError(429, "rate_limited", { retry_after_sec: Math.ceil((cur.reset - now) / 1000) }));
    next();
  };
}
