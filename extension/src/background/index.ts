/**
 * Background service worker: the only part of the extension that talks to the
 * network. Message router validates every inbound message against the shared
 * Zod schema AND checks the sender before doing anything, so a compromised or
 * unrelated web page cannot use chrome.runtime.sendMessage to reach this worker
 * (that's only reachable by extension pages/content scripts to begin with, but
 * we still verify sender.id defensively — see isTrustedSender).
 */
import { fetchScores } from "./api.js";
import { getCached, hashText, setCached } from "./cache.js";
import { getSettings, getStats, recordScored, updateSettings } from "./settings.js";
import { RuntimeMessageSchema, type CommentScore } from "../shared/validation.js";

function isTrustedSender(sender: chrome.runtime.MessageSender): boolean {
  // Messages from this same extension's content scripts/popup carry our own id.
  // Chrome does not deliver runtime messages from arbitrary web pages unless the
  // page is explicitly listed as `externally_connectable`, which this extension
  // does not declare — this check is defense-in-depth, not the only barrier.
  return sender.id === chrome.runtime.id;
}

async function handleScoreComments(comments: { id: string; text: string }[]) {
  const hashes = await Promise.all(comments.map((c) => hashText(c.text)));
  const cached = await getCached(hashes);

  const missIndexes: number[] = [];
  const results: (CommentScore | undefined)[] = comments.map((_, i) => {
    const hit = cached.get(hashes[i] as string);
    if (!hit) missIndexes.push(i);
    return hit;
  });

  let modelVersion = "cached";
  if (missIndexes.length > 0) {
    const missComments = missIndexes.map((i) => comments[i]!);
    const response = await fetchScores(missComments);
    modelVersion = response.model_version;

    const toCache = new Map<string, CommentScore>();
    response.results.forEach((score, j) => {
      const originalIndex = missIndexes[j];
      if (originalIndex === undefined) return;
      results[originalIndex] = score;
      toCache.set(hashes[originalIndex] as string, score);
    });
    await setCached(toCache);
  }

  const finalResults = results.filter((r): r is CommentScore => r !== undefined);
  const settings = await getSettings();
  const flagged = finalResults.filter((r) => r.toxicity >= settings.threshold).length;
  recordScored(finalResults.length, flagged);

  return { results: finalResults, model_version: modelVersion };
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isTrustedSender(sender)) {
    return false; // ignore silently; do not reveal that a handler exists
  }

  const parsed = RuntimeMessageSchema.safeParse(raw);
  if (!parsed.success) {
    sendResponse({ error: "Invalid message" });
    return false;
  }
  const message = parsed.data;

  (async () => {
    try {
      switch (message.type) {
        case "SCORE_COMMENTS":
          sendResponse(await handleScoreComments(message.comments));
          break;
        case "GET_SETTINGS":
          sendResponse(await getSettings());
          break;
        case "SET_SETTINGS":
          sendResponse(await updateSettings(message.settings));
          break;
        case "GET_STATS":
          sendResponse(getStats());
          break;
      }
    } catch (err) {
      console.error("commentlens background error:", err instanceof Error ? err.message : "unknown");
      sendResponse({ error: "Internal error" });
    }
  })();

  return true; // keep the message channel open for the async response above
});