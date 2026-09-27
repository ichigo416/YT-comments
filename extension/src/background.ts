import { MAX_BATCH, MAX_TEXT_LENGTH, type Score, type ScoreRequest, type ScoreResponse } from "./shared/types";

const REQUEST_TIMEOUT_MS = 8_000;
const YOUTUBE_ORIGIN = "https://www.youtube.com";

function isScoreRequest(message: unknown): message is ScoreRequest {
  if (typeof message !== "object" || message === null) return false;
  const { type, texts } = message as Record<string, unknown>;
  return (
    type === "SCORE" &&
    Array.isArray(texts) &&
    texts.length > 0 &&
    texts.length <= MAX_BATCH &&
    texts.every((t) => typeof t === "string" && t.length > 0 && t.length <= MAX_TEXT_LENGTH)
  );
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function parseScores(data: unknown, expected: number): Score[] | null {
  const scores = (data as { scores?: unknown } | null)?.scores;
  if (!Array.isArray(scores) || scores.length !== expected) return null;

  const result: Score[] = [];
  for (const item of scores) {
    const { toxicity, labels } = (item ?? {}) as Record<string, unknown>;
    if (!isProbability(toxicity) || typeof labels !== "object" || labels === null) return null;
    const cleanLabels: Record<string, number> = {};
    for (const [name, p] of Object.entries(labels)) {
      if (isProbability(p)) cleanLabels[name] = p;
    }
    result.push({ toxicity, labels: cleanLabels });
  }
  return result;
}

async function requestScores(texts: string[]): Promise<ScoreResponse> {
  try {
    const response = await fetch(`${__API_BASE__}/api/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `http_${response.status}` };

    const scores = parseScores(await response.json(), texts.length);
    return scores ? { ok: true, scores } : { ok: false, error: "bad_response" };
  } catch {
    return { ok: false, error: "network" };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only our own content script, running on YouTube, may use this API.
  const fromYouTube = sender.id === chrome.runtime.id && sender.url?.startsWith(`${YOUTUBE_ORIGIN}/`);
  if (!fromYouTube) return false;

  if (!isScoreRequest(message)) {
    sendResponse({ ok: false, error: "bad_request" } satisfies ScoreResponse);
    return false;
  }

  void requestScores(message.texts).then(sendResponse);
  return true; // keep the message channel open for the async response
});
