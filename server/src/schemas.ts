import { z } from "zod";

export const MAX_BATCH = 50;
export const MAX_TEXT_LENGTH = 1000;

/** Body accepted from the browser extension. Unknown keys are rejected. */
export const scoreRequestSchema = z
  .object({
    texts: z.array(z.string().min(1).max(MAX_TEXT_LENGTH)).min(1).max(MAX_BATCH),
  })
  .strict();

const probability = z.number().min(0).max(1);

export const scoreSchema = z.object({
  toxicity: probability,
  labels: z.record(probability),
});

/** Response we trust from the inference service only after it passes this check. */
export const inferenceResponseSchema = z.object({
  scores: z.array(scoreSchema).min(1).max(MAX_BATCH),
});

export type Score = z.infer<typeof scoreSchema>;
