/**
 * POST /api/score — the extension's only endpoint on this server.
 * Body is Zod-validated before anything touches the inference client.
 */
import { Router } from "express";
import { ScoreRequestSchema } from "../schemas.js";
import { scoreComments } from "../services/inferenceClient.js";

export const scoreRouter = Router();

scoreRouter.post("/", async (req, res, next) => {
  try {
    const { comments } = ScoreRequestSchema.parse(req.body);
    const result = await scoreComments(comments);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});