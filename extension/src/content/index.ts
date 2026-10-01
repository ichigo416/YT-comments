/**
 * Content script bootstrap. Runs on youtube.com watch pages only (see
 * manifest.json content_scripts.matches). Wires the DOM observer to the
 * background worker and applies results back onto the page.
 */
import { getSettings, scoreComments } from "../shared/messages.js";
import type { Settings } from "../shared/validation.js";
import { CommentObserver, type DiscoveredComment } from "./commentObserver.js";
import { applyScore, ensureStylesInjected } from "./commentRenderer.js";
import { SELECTORS } from "./selectors.js";

let settings: Settings | null = null;
let currentUrl = location.href;

async function handleBatch(batch: DiscoveredComment[]): Promise<void> {
  if (!settings?.enabled) return;
  try {
    const response = await scoreComments(batch.map((c) => ({ id: c.id, text: c.text })));
    const byId = new Map(response.results.map((r) => [r.id, r]));
    for (const comment of batch) {
      const score = byId.get(comment.id);
      if (score) applyScore(comment.element, score, settings);
    }
  } catch (err) {
    // Fail silent-and-visible: comments simply stay unscored; never break YouTube's own UI.
    console.warn("CommentLens: could not score a batch:", err instanceof Error ? err.message : "unknown");
  }
}

function watchForSpaNavigation(observer: CommentObserver): void {
  // YouTube is a single-page app; "yt-navigate-finish" fires on client-side navigation.
  document.addEventListener("yt-navigate-finish", () => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    observer.resetForNavigation();
  });
}

async function main(): Promise<void> {
  if (!location.hostname.endsWith("youtube.com")) return;

  ensureStylesInjected();
  settings = await getSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes["commentlens_settings_v1"]) {
      void getSettings().then((s) => {
        settings = s;
      });
    }
  });

  const observer = new CommentObserver((batch) => void handleBatch(batch));
  // The comments container loads asynchronously; wait for it before observing,
  // retrying briefly rather than polling forever.
  const waitForContainer = setInterval(() => {
    if (document.querySelector(SELECTORS.commentsContainer)) {
      clearInterval(waitForContainer);
      observer.start();
      watchForSpaNavigation(observer);
    }
  }, 500);
  setTimeout(() => clearInterval(waitForContainer), 20_000);
}

void main();