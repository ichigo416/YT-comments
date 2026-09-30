/**
 * Per-IP sliding-window rate limit. Express is configured with `trust proxy`
 * set narrowly (see app.ts) so req.ip reflects the real client, not a spoofable header.
 */
import rateLimit from "express-rate-limit";
import { config } from "../config.js";

export const scoreRateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
}); 