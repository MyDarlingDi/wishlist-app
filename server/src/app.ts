import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { requireAuth } from "./auth/middleware.js";
import type { Config } from "./config.js";
import type { DB } from "./db/client.js";
import { HttpError } from "./errors.js";
import { apiRouter, imageRouter } from "./routes/api.js";
import type { Notifier } from "./services/notify.js";
import type { Vision } from "./services/vision.js";

export interface AppDeps {
  cfg: Config;
  db: DB;
  notifier: Notifier;
  vision: Vision | null;
  /** grammY webhook handler, mounted at /telegram/webhook. */
  webhook?: express.RequestHandler;
}

export function createApp(deps: AppDeps) {
  const { cfg, db } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const allowed = new Set([new URL(cfg.WEBAPP_URL).origin]);
  if (cfg.NODE_ENV !== "production") ["http://localhost:5173", "http://127.0.0.1:5173"].forEach((o) => allowed.add(o));
  app.use(cors({ origin: (o, cb) => cb(null, !o || allowed.has(o)), allowedHeaders: ["Content-Type", "Authorization"] }));

  app.get("/", (_req, res) => void res.json({ ok: true, service: "wishlist-server" }));
  app.get("/health", (_req, res) => void res.json({ ok: true }));

  if (deps.webhook) app.post("/telegram/webhook", express.json({ limit: "1mb" }), deps.webhook);

  app.use("/api", imageRouter(db));
  // Auth first, body parsing second: anonymous callers can't make us buffer large uploads.
  app.use("/api", requireAuth(cfg, db), express.json({ limit: "12mb" }), apiRouter(deps));

  app.use((_req, _res, next) => next(new HttpError(404, "not_found")));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.code, ...err.extra });
    if (err instanceof ZodError) return void res.status(400).json({ error: "bad_request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const status = (err as { status?: number }).status;
    if (status === 413) return void res.status(413).json({ error: "too_large" });
    if (status === 400) return void res.status(400).json({ error: "bad_request" });
    console.error(err);
    res.status(500).json({ error: "internal" });
  });
  return app;
}
