export type DisplayMode = "badge" | "blur";

export interface Settings {
  enabled: boolean;
  mode: DisplayMode;
  /** Toxicity at or above this value (0-1) is flagged. */
  threshold: number;
}

export interface Score {
  toxicity: number;
  labels: Record<string, number>;
}

export interface ScoreRequest {
  type: "SCORE";
  texts: string[];
}

export type ScoreResponse = { ok: true; scores: Score[] } | { ok: false; error: string };

export const MAX_BATCH = 50;
export const MAX_TEXT_LENGTH = 1000;
