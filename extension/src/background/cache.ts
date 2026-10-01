/**
 * Bounded, expiring cache of comment-text-hash -> score, stored in
 * chrome.storage.session (cleared when the browser closes; never touches disk).
 *
 * - Keyed by a SHA-256 hash of the normalised text, not the raw text or the
 *   page's comment id — this avoids storing any personal text as a key and
 *   lets identical comments across different videos share a cache hit.
 * - Bounded to CACHE_MAX_ENTRIES with oldest-first eviction, and entries expire
 *   after CACHE_TTL_MS, so this can never grow without limit across a long session.
 */
import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from "../shared/constants.js";
import type { CommentScore } from "../shared/validation.js";

const STORE_KEY = "commentlens_cache_v1";

interface CacheEntry {
  score: CommentScore;
  expiresAt: number;
}

type CacheStore = Record<string, CacheEntry>;

async function readStore(): Promise<CacheStore> {
  const result = await chrome.storage.session.get(STORE_KEY);
  const store = result[STORE_KEY] as CacheStore | undefined;
  return store ?? {};
}

async function writeStore(store: CacheStore): Promise<void> {
  await chrome.storage.session.set({ [STORE_KEY]: store });
}

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pruneExpired(store: CacheStore, now: number): CacheStore {
  const next: CacheStore = {};
  for (const [key, entry] of Object.entries(store)) {
    if (entry.expiresAt > now) next[key] = entry;
  }
  return next;
}

function evictOldestIfNeeded(store: CacheStore): CacheStore {
  const keys = Object.keys(store);
  if (keys.length <= CACHE_MAX_ENTRIES) return store;
  // Object.entries preserves insertion order for string keys; the ones written
  // first (typically longest-ago) are evicted first.
  const overflow = keys.length - CACHE_MAX_ENTRIES;
  const toDrop = keys.slice(0, overflow);
  const next = { ...store };
  for (const key of toDrop) delete next[key];
  return next;
}

export async function getCached(hashes: string[]): Promise<Map<string, CommentScore>> {
  const now = Date.now();
  const store = pruneExpired(await readStore(), now);
  const found = new Map<string, CommentScore>();
  for (const hash of hashes) {
    const entry = store[hash];
    if (entry) found.set(hash, entry.score);
  }
  return found;
}

export async function setCached(entries: Map<string, CommentScore>): Promise<void> {
  if (entries.size === 0) return;
  const now = Date.now();
  let store = pruneExpired(await readStore(), now);
  for (const [hash, score] of entries) {
    store[hash] = { score, expiresAt: now + CACHE_TTL_MS };
  }
  store = evictOldestIfNeeded(store);
  await writeStore(store);
}