/**
 * Express application factory. Building it in a function (rather than at module
 * scope) lets tests create isolated instances with supertest.
 * Security stack, applied in order:
 *  1. helmet          - sets standard security headers (CSP, no-sniff, etc.)
 *  2. cors            - allow-list only; the extension's chrome-extension:// origin
 *                       must be added to ALLOWED_ORIGINS, no wildcard in production
 *  3. json body-limit - small cap; this API only ever receives short comment batches
 *  4. rate limiter     - per-IP, only on the expensive /api/score route
 *  5. routes
 *  6. 404 + centralised error handler (must be registered last)
 */
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { scoreRateLimiter } from "./middleware/rateLimiter.js";
import { healthRouter } from "./routes/health.js";
import { scoreRouter } from "./routes/score.js";

export function createApp(): Express {
  const app = express();

  // Only trust the first hop (e.g. a single reverse proxy). Do NOT set this to
  // `true` — that would trust the client-supplied X-Forwarded-For and let the
  // rate limiter be bypassed by spoofing it.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true, directives: { "default-src": ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header (curl, server-to-server, health checks) is allowed through;
        // browser requests always send Origin, so this doesn't weaken the check for them.
        if (!origin || config.ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
    }),
  );

  app.use(express.json({ limit: "100kb" }));

  app.use("/health", healthRouter);
  app.use("/api/score", scoreRateLimiter, scoreRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
