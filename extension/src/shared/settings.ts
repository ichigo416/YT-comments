import type { DisplayMode, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = { enabled: true, mode: "badge", threshold: 0.7 };

const MODES: readonly DisplayMode[] = ["badge", "blur"];

/** Never trust stored values blindly: coerce anything unexpected back to a safe default. */
export function sanitizeSettings(raw: unknown): Settings {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const threshold =
    typeof value.threshold === "number" && Number.isFinite(value.threshold)
      ? Math.min(0.95, Math.max(0.3, value.threshold))
      : DEFAULT_SETTINGS.threshold;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled,
    mode: MODES.includes(value.mode as DisplayMode) ? (value.mode as DisplayMode) : DEFAULT_SETTINGS.mode,
    threshold,
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return sanitizeSettings(stored);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set(sanitizeSettings(settings));
}
