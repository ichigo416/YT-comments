/**
 * Authenticated client for the private FastAPI inference service.
 * - Sends the shared secret in a header, never in the URL or logs.
 * - Times out and retries once on network failure, never on a validation error (4xx).
 * - Validates the upstream response shape before it reaches the route handler.
 */
import { config } from "../config.js";
import { InferenceResponseSchema, type CommentInput, type InferenceResponse } from "../schemas.js";

export class InferenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "InferenceError";
  }
}

const ENDPOINT = new URL("/predict/batch", config.INFERENCE_URL).toString();

async function postOnce(comments: CommentInput[], signal: AbortSignal): Promise<Response> {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": config.INTERNAL_API_TOKEN,
    },
    body: JSON.stringify({ comments }),
    signal,
  });
}

export async function scoreComments(comments: CommentInput[]): Promise<InferenceResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.INFERENCE_TIMEOUT_MS);
    try {
      const res = await postOnce(comments, controller.signal);
      clearTimeout(timer);

      if (!res.ok) {
        // Never retry a 4xx: it means our request was malformed, retrying changes nothing.
        if (res.status >= 400 && res.status < 500) {
          throw new InferenceError(`Inference service rejected the request (${res.status})`, 502);
        }
        throw new InferenceError(`Inference service error (${res.status})`, 502);
      }

      const json: unknown = await res.json();
      const parsed = InferenceResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new InferenceError("Inference service returned an unexpected response shape", 502);
      }
      return parsed.data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof InferenceError) throw err; // don't retry validation/4xx failures
      lastError = err;
      // one retry only, for transient network errors / timeouts
    }
  }

  const isAbort = lastError instanceof Error && lastError.name === "AbortError";
  throw new InferenceError(isAbort ? "Inference service timed out" : "Could not reach inference service", 503);
}