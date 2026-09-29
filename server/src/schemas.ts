/**
 * Request/response validation. Zod both validates and infers TypeScript types,
 * so there is a single source of truth (see .env.example note: no separate types.ts).
 */
import { z } from "zod";
import { config } from "./config.js";

// Matches ml/inference: max 2000 chars per comment, safe id charset, no extra keys.
const CommentInputSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "id may contain only letters, numbers, '_' and '-'"),
    text: z.string().min(1).max(2000),
  })
  .strict();

export const ScoreRequestSchema = z
  .object({
    comments: z
      .array(CommentInputSchema)
      .min(1, "comments must contain at least one item")
      .max(config.MAX_COMMENTS_PER_REQUEST, `comments may contain at most ${config.MAX_COMMENTS_PER_REQUEST} items`)
      .refine(
        (items) => new Set(items.map((c) => c.id)).size === items.length,
        "comment ids must be unique",
      ),
  })
  .strict();

export type ScoreRequest = z.infer<typeof ScoreRequestSchema>;
export type CommentInput = z.infer<typeof CommentInputSchema>;

export const CommentScoreSchema = z.object({
  id: z.string(),
  toxicity: z.number().min(0).max(1),
  categories: z.record(z.string(), z.number()),
});

export const InferenceResponseSchema = z.object({
  results: z.array(CommentScoreSchema),
  model_version: z.string(),
});

export type CommentScore = z.infer<typeof CommentScoreSchema>;
export type InferenceResponse = z.infer<typeof InferenceResponseSchema>;