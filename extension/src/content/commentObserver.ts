/**
 * Watches the comments container for new comment threads (YouTube renders them
 * lazily as the user scrolls) and reports newly-seen, non-empty comments in
 * small debounced batches. Handles SPA navigation, since YouTube never does a
 * full page reload between videos.
 */
import { MAX_BATCH_SIZE } from "../shared/constants.js";
import { extractCommentId, extractCommentText, SELECTORS } from "./selectors.js";

export interface DiscoveredComment {
  id: string;
  text: string;
  element: Element;
}

const DEBOUNCE_MS = 400;

export class CommentObserver {
  private seenIds = new Set<string>();
  private domObserver: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private indexCounter = 0;

  constructor(private readonly onBatch: (batch: DiscoveredComment[]) => void) {}

  start(): void {
    this.scanAndSchedule();
    this.domObserver = new MutationObserver(() => this.scheduleScan());
    this.domObserver.observe(document.body, { childList: true, subtree: true });
  }

  stop(): void {
    this.domObserver?.disconnect();
    this.domObserver = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  /** Call when YouTube's SPA navigates to a new video: comment ids reset. */
  resetForNavigation(): void {
    this.seenIds.clear();
    this.indexCounter = 0;
    this.scheduleScan();
  }

  private scheduleScan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.scanAndSchedule(), DEBOUNCE_MS);
  }

  private scanAndSchedule(): void {
    const threads = document.querySelectorAll(SELECTORS.commentThread);
    const batch: DiscoveredComment[] = [];

    for (const thread of threads) {
      if (batch.length >= MAX_BATCH_SIZE) break;
      const id = extractCommentId(thread, this.indexCounter++);
      if (this.seenIds.has(id)) continue;

      const text = extractCommentText(thread);
      if (!text) continue; // not rendered yet, or genuinely empty; skip, don't mark seen

      this.seenIds.add(id);
      batch.push({ id, text, element: thread });
    }

    if (batch.length > 0) this.onBatch(batch);
  }
}