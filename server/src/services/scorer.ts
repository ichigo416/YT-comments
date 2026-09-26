import { config } from "../config.js";
import { inferenceResponseSchema, type Score } from "../schemas.js";

const INFERENCE_TIMEOUT_MS = 5_000;

export class UpstreamError extends Error {}

export async function scoreTexts(texts: string[]): Promise<Score[]> {
  let response: Response;
  try {
    response = await fetch(new URL("/predict/batch", config.INFERENCE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.INTERNAL_TOKEN,
      },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("Inference service unreachable");
  }

  if (!response.ok) {
    throw new UpstreamError(`Inference service responded with ${response.status}`);
  }

  const parsed = inferenceResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.scores.length !== texts.length) {
    throw new UpstreamError("Inference service returned an unexpected payload");
  }
  return parsed.data.scores;
}
