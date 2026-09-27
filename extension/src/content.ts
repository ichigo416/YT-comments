import { DEFAULT_SETTINGS, loadSettings } from "./shared/settings";
import {
  MAX_BATCH,
  MAX_TEXT_LENGTH,
  type Score,
  type ScoreRequest,
  type ScoreResponse,
  type Settings,
} from "./shared/types";

// YouTube's markup changes; keep every selector in one place.
const COMMENT_TEXT_SELECTOR = "ytd-comments #content-text";
const SCORE_ATTR = "data-ytcs-score";
const PENDING_ATTR = "data-ytcs-pending";

const SCAN_DEBOUNCE_MS = 300;
const ERROR_COOLDOWN_MS = 15_000;
const CACHE_LIMIT = 2_000;

let settings: Settings = DEFAULT_SETTINGS;
let scanTimer: number | undefined;
let cooldownUntil = 0;

const cache = new Map<string, Score>();
const badges = new WeakMap<Element, HTMLButtonElement>();
/** The text each element was last scored with, so recycled or edited comments get re-scored. */
const scoredText = new WeakMap<Element, string>();

function cacheSet(text: string, score: Score): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(text, score);
}

function readText(el: Element): string {
  return (el.textContent ?? "").trim().slice(0, MAX_TEXT_LENGTH);
}

function severity(toxicity: number): "low" | "medium" | "high" {
  if (toxicity >= settings.threshold) return "high";
  return toxicity >= settings.threshold * 0.6 ? "medium" : "low";
}

/** Renders (or clears) the badge and blur state for one comment. Uses textContent only, never innerHTML. */
function render(el: HTMLElement, toxicity: number): void {
  badges.get(el)?.remove();
  badges.delete(el);
  el.classList.remove("ytcs-blur", "ytcs-revealed");

  if (!settings.enabled) return;

  const level = severity(toxicity);
  const flagged = level === "high";
  const blurred = flagged && settings.mode === "blur";

  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = `ytcs-badge ytcs-${level}`;
  badge.textContent = blurred
    ? `Toxic ${Math.round(toxicity * 100)}% – show comment`
    : `Toxicity ${Math.round(toxicity * 100)}%`;

  if (blurred) {
    el.classList.add("ytcs-blur");
    badge.addEventListener("click", () => {
      const revealed = el.classList.toggle("ytcs-revealed");
      badge.textContent = revealed
        ? `Toxic ${Math.round(toxicity * 100)}% – hide comment`
        : `Toxic ${Math.round(toxicity * 100)}% – show comment`;
    });
  } else {
    badge.tabIndex = -1;
    badge.disabled = true;
  }

  el.insertAdjacentElement("afterend", badge);
  badges.set(el, badge);
}

function applyScore(el: HTMLElement, text: string, score: Score): void {
  scoredText.set(el, text);
  el.setAttribute(SCORE_ATTR, String(score.toxicity));
  render(el, score.toxicity);
}

function rerenderAll(): void {
  document.querySelectorAll<HTMLElement>(`[${SCORE_ATTR}]`).forEach((el) => {
    const toxicity = Number(el.getAttribute(SCORE_ATTR));
    if (Number.isFinite(toxicity)) render(el, toxicity);
  });
}

function sendScoreRequest(texts: string[]): Promise<ScoreResponse> {
  const request: ScoreRequest = { type: "SCORE", texts };
  return chrome.runtime
    .sendMessage(request)
    .then((response: unknown) => response as ScoreResponse)
    .catch(() => ({ ok: false, error: "messaging" }) as ScoreResponse);
}

async function scoreBatch(items: { el: HTMLElement; text: string }[]): Promise<void> {
  const uncached: { el: HTMLElement; text: string }[] = [];

  for (const item of items) {
    const hit = cache.get(item.text);
    if (hit) {
      applyScore(item.el, item.text, hit);
      item.el.removeAttribute(PENDING_ATTR);
    } else {
      uncached.push(item);
    }
  }
  if (uncached.length === 0) return;

  const response = await sendScoreRequest(uncached.map((item) => item.text));

  if (!response.ok) {
    cooldownUntil = Date.now() + ERROR_COOLDOWN_MS;
    window.setTimeout(scheduleScan, ERROR_COOLDOWN_MS);
    uncached.forEach(({ el }) => el.removeAttribute(PENDING_ATTR));
    return;
  }

  uncached.forEach(({ el, text }, index) => {
    const score = response.scores[index];
    el.removeAttribute(PENDING_ATTR);
    if (!score) return;
    cacheSet(text, score);
    applyScore(el, text, score);
  });
}

async function scan(): Promise<void> {
  if (!settings.enabled || Date.now() < cooldownUntil) return;

  const fresh = Array.from(
    document.querySelectorAll<HTMLElement>(`${COMMENT_TEXT_SELECTOR}:not([${PENDING_ATTR}])`),
  )
    .map((el) => ({ el, text: readText(el) }))
    .filter(({ el, text }) => text !== "" && scoredText.get(el) !== text);

  for (let i = 0; i < fresh.length; i += MAX_BATCH) {
    const batch = fresh.slice(i, i + MAX_BATCH);
    batch.forEach(({ el }) => el.setAttribute(PENDING_ATTR, "1"));
    await scoreBatch(batch);
  }
}

function scheduleScan(): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), SCAN_DEBOUNCE_MS);
}

async function init(): Promise<void> {
  settings = await loadSettings();

  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== "sync") return;
    void loadSettings().then((next) => {
      settings = next;
      rerenderAll();
      scheduleScan();
    });
  });

  scheduleScan();
}

void init();
