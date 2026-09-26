import { Router } from "express";
import { scoreRequestSchema } from "../schemas.js";
import { scoreTexts, UpstreamError } from "../services/scorer.js";

export const scoreRouter = Router();

scoreRouter.post("/score", async (req, res, next) => {
  const body = scoreRequestSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  try {
    const scores = await scoreTexts(body.data.texts);
    res.json({ scores });
  } catch (error) {
    if (error instanceof UpstreamError) {
      // Log the reason server-side (never the comment text); return a generic message.
      console.error("[score] upstream failure:", error.message);
      res.status(502).json({ error: "scoring_unavailable" });
      return;
    }
    next(error);
  }
});
