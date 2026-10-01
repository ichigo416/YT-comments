/**
 * Renders scoring results onto the page. Uses textContent exclusively for any
 * comment-derived or model-derived string — never innerHTML — so nothing the
 * model or a comment author writes can execute as markup (stored-XSS class of
 * bug). Badge/blur/hide are pure CSS class toggles on elements we created.
 */
import { DISPLAY_MODE } from "../shared/constants.js";
import type { CommentScore, Settings } from "../shared/validation.js";
import { SELECTORS } from "./selectors.js";

const BADGE_CLASS = "commentlens-badge";
const BLUR_CLASS = "commentlens-blurred";
const HIDDEN_CLASS = "commentlens-hidden";
const STYLE_ID = "commentlens-styles";

export function ensureStylesInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Static CSS only — no interpolation of any external or comment-derived value.
  style.textContent = `
    .${BADGE_CLASS} {
      display: inline-block; margin-left: 6px; padding: 1px 6px;
      border-radius: 4px; font-size: 11px; font-weight: 600;
      background: #dc2626; color: #fff; vertical-align: middle;
    }
    .${BLUR_CLASS} { filter: blur(6px); transition: filter 0.15s ease; }
    .${BLUR_CLASS}:hover { filter: none; }
    .${HIDDEN_CLASS} { display: none !important; }
  `;
  document.head.appendChild(style);
}

function clearPreviousMarking(threadEl: Element): void {
  threadEl.classList.remove(BLUR_CLASS, HIDDEN_CLASS);
  threadEl.querySelector(`.${BADGE_CLASS}`)?.remove();
}

export function applyScore(threadEl: Element, score: CommentScore, settings: Settings): void {
  clearPreviousMarking(threadEl);
  if (score.toxicity < settings.threshold) return;

  switch (settings.mode) {
    case DISPLAY_MODE.HIDE:
      threadEl.classList.add(HIDDEN_CLASS);
      return;
    case DISPLAY_MODE.BLUR:
      threadEl.classList.add(BLUR_CLASS);
      return;
    case DISPLAY_MODE.BADGE:
    default: {
      const textNode = threadEl.querySelector(SELECTORS.commentText);
      if (!textNode) return;
      const badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.textContent = `⚠ ${Math.round(score.toxicity * 100)}%`; // static template + a number; never comment text
      textNode.appendChild(badge);
    }
  }
}