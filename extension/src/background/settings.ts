/**
 * Persisted user settings (chrome.storage.sync — small, replicated across the
 * user's signed-in browsers) and in-memory session stats (reset on restart).
 * Every read is validated; storage written by an older/future version of this
 * extension, or corrupted, never reaches the rest of the app unchecked.
 */
import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { SettingsSchema, type PartialSettings, type Settings, type Stats } from "../shared/validation.js";

const SETTINGS_KEY = "commentlens_settings_v1";

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  const parsed = SettingsSchema.safeParse(result[SETTINGS_KEY]);
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

export async function updateSettings(patch: PartialSettings): Promise<Settings> {
  const current = await getSettings();
  const merged = { ...current, ...patch };
  const parsed = SettingsSchema.safeParse(merged);
  const next = parsed.success ? parsed.data : current;
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

// Session-only counters for the popup; intentionally not persisted to disk.
let stats: Stats = { scoredCount: 0, flaggedCount: 0 };

export function getStats(): Stats {
  return { ...stats };
}

export function recordScored(count: number, flagged: number): void {
  stats = { scoredCount: stats.scoredCount + count, flaggedCount: stats.flaggedCount + flagged };
}