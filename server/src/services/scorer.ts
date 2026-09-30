import { config } from "../config.js";
import { InferenceResponseSchema, type InferenceResponse } from "../schemas.js";

const INFERENCE_TIMEOUT_MS = 5_000;

export class UpstreamError extends Error {}

export async function scoreTexts(texts: string[]): Promise<InferenceResponse["results"]> {
  let response: Response;
  try {
    response = await fetch(new URL("/predict/batch", config.INFERENCE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.INTERNAL_API_TOKEN,
      },
      body: JSON.stringify({ comments: texts.map((text, index) => ({ id: String(index), text })) }),
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("Inference service unreachable");
  }

  if (!response.ok) {
    throw new UpstreamError(`Inference service responded with ${response.status}`);
  }

  const parsed = InferenceResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.results.length !== texts.length) {
    throw new UpstreamError("Inference service returned an unexpected payload");
  }
  return parsed.data.results;
}
