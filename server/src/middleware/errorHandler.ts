/**
 * Centralised error handling.
 * - Zod errors -> 400 with field-level detail (safe: only tells the caller what
 *   THEY sent wrong, never leaks server internals).
 * - InferenceError -> its own status.
 * - body-parser errors (bad JSON, oversized body) -> 400/413.
 * - Anything else -> 500 with a generic message; the real error is logged server-side
 *   only, and never includes request bodies (comment text stays out of logs).
 */
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { InferenceError } from "../services/inferenceClient.js";

function isBodyParserError(err: unknown): err is { status?: number; type?: string } {
  return typeof err === "object" && err !== null && ("status" in err || "type" in err);
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  if (err instanceof InferenceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof Error && err.message === "Not allowed by CORS") {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }
  if (isBodyParserError(err) && (err.status === 413 || err.type === "entity.too.large")) {
    res.status(413).json({ error: "Request body too large" });
    return;
  }

  console.error("Unhandled error:", err instanceof Error ? err.message : "unknown");
  res.status(500).json({ error: "Internal server error" });
} 
