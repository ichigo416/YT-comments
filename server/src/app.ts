import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config, isProduction } from "./config.js";
import { scoreRouter } from "./routes/score.js";

/** Requests without an Origin header (curl, scripts) are only accepted outside production. */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return !isProduction;
  return config.ALLOWED_ORIGINS.includes(origin);
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  if (config.TRUST_PROXY === "1") app.set("trust proxy", 1);

  app.use(helmet());

  // Reject unknown origins outright (CORS alone only hides responses from browsers).
  app.use((req, res, next) => {
    if (req.path === "/health" || isAllowedOrigin(req.headers.origin)) {
      next();
      return;
    }
    res.status(403).json({ error: "forbidden_origin" });
  });

  app.use(cors({ origin: config.ALLOWED_ORIGINS, methods: ["POST"], allowedHeaders: ["Content-Type"], maxAge: 600 }));

  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "rate_limited" },
    }),
    scoreRouter,
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    // Malformed JSON and oversized bodies are client errors; everything else is ours.
    const status = typeof error?.status === "number" && error.status < 500 ? error.status : 500;
    if (status === 500) console.error("[error]", error);
    res.status(status).json({ error: status === 500 ? "internal_error" : "invalid_request" });
  };
  app.use(errorHandler);

  return app;
}
