/**
 * All YouTube DOM selectors, isolated here so a YouTube markup change means
 * editing one file. These are CSS selectors only, never used to build HTML.
 */
export const SELECTORS = {
  commentThread: "ytd-comment-thread-renderer",
  commentRenderer: "ytd-comment-view-model, ytd-comment-renderer",
  commentText: "#content-text",
  commentsContainer: "ytd-comments#comments, #comments",
} as const;

export function extractCommentId(threadEl: Element, fallbackIndex: number): string {
  const explicit = threadEl.getAttribute("id") || threadEl.getAttribute("data-comment-id");
  if (explicit) return explicit.slice(0, 64);
  // Fallback: stable-ish for one page load, not persisted or relied on across reloads.
  return `idx-${fallbackIndex}`;
}

export function extractCommentText(threadEl: Element): string | null {
  const node = threadEl.querySelector(SELECTORS.commentText);
  const text = node?.textContent?.trim();
  return text ? text : null;
}