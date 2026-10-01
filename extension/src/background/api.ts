/**
 * The extension's only outbound network call: POST to our own gateway server
 * (never directly to the inference service, which is private).
 *
 * - HTTPS-only, except for an explicit localhost/127.0.0.1 allowance for local
 *   development. A production build (build.mjs) always defines SERVER_URL as
 *   an https:// origin, so this check exists as defense-in-depth, not the only gate.
 * - The response is fully re-validated with Zod; nothing from the network is
 *   trusted just because the HTTP status was 200.
 */
import { MAX_TEXT_LENGTH, SERVER_URL } from "../shared/constants.js";
import { ServerResponseSchema, type CommentPayload, type ServerResponse } from "../shared/validation.js";

const REQUEST_TIMEOUT_MS = 8000;

function assertUsableEndpoint(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SERVER_URL is not a valid URL");
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new Error("Refusing to call a non-HTTPS endpoint");
  }
  return parsed;
}

export async function fetchScores(comments: CommentPayload[]): Promise<ServerResponse> {
  const endpoint = assertUsableEndpoint(SERVER_URL);
  endpoint.pathname = "/api/score";

  // Defense-in-depth: the shared schema already enforces this server-side and
  // in the popup/content layers, but a truncated length here costs nothing.
  const safeComments = comments.map((c) => ({ ...c, text: c.text.slice(0, MAX_TEXT_LENGTH) }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments: safeComments }),
      signal: controller.signal,
      credentials: "omit", // no cookies; this API is unauthenticated by design (CORS-gated)
    });
    if (!res.ok) {
      throw new Error(`Server responded with ${res.status}`);
    }
    const json: unknown = await res.json();
    const parsed = ServerResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Server returned an unexpected response shape");
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}