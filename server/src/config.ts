/**
 * Environment configuration, validated at startup with Zod. Any bad or missing
 * value throws before the server binds a port ("fail fast" rather than serving
 * with a silently-wrong default).
 */
import "dotenv/config";
import { z } from "zod";

const originList = (v: string) =>
  v.split(",").map((s) => s.trim()).filter(Boolean);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // Origins allowed to call this API (e.g. the extension's chrome-extension:// origin).
  ALLOWED_ORIGINS: z.string().min(1).transform(originList),

  // Base URL of the private FastAPI inference service. Must not be a public host in production.
  INFERENCE_URL: z.string().url(),

  // Shared secret sent to the inference service. Must equal its INTERNAL_API_TOKEN.
  INTERNAL_API_TOKEN: z.string().min(32, "INTERNAL_API_TOKEN must be at least 32 characters"),

  INFERENCE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  // Comma separated list of comma-less strings; total request body stays small regardless.
  MAX_COMMENTS_PER_REQUEST: z.coerce.number().int().positive().max(200).default(100),
});

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    const inferenceHost = new URL(env.INFERENCE_URL).hostname;
    const isPrivateHost = inferenceHost === "localhost" || inferenceHost === "127.0.0.1" || inferenceHost === "::1";
    if (env.INFERENCE_URL.startsWith("http://") && !isPrivateHost) {
      console.error("INFERENCE_URL must use HTTPS in production (or stay on localhost/private network).");
      process.exit(1);
    }
    if (env.ALLOWED_ORIGINS.includes("*")) {
      console.error("ALLOWED_ORIGINS may not be '*' in production.");
      process.exit(1);
    }
  }
  return env;
}

export const config = loadConfig();
export type Config = typeof config;