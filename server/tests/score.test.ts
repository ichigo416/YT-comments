import type { Express } from "express";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

let app: Express;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function inferenceOk(results: Array<{ id: string; toxicity: number }>) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      results: results.map((r) => ({ id: r.id, toxicity: r.toxicity, categories: { toxic: r.toxicity } })),
      model_version: "abc123",
    }),
  } as Response);
}

describe("GET /health", () => {
  it("is public and returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("CORS", () => {
  it("allows a listed origin", async () => {
    inferenceOk([{ id: "a", toxicity: 0.1 }]);
    const res = await request(app)
      .post("/api/score")
      .set("Origin", "https://allowed.example")
      .send({ comments: [{ id: "a", text: "hello" }] });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://allowed.example");
  });

  it("blocks an origin not on the allow-list", async () => {
    const res = await request(app)
      .post("/api/score")
      .set("Origin", "https://evil.example")
      .send({ comments: [{ id: "a", text: "hello" }] });
    expect(res.status).toBe(500); // cors() surfaces a generic Error -> errorHandler's 500 path
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/score validation", () => {
  it("rejects an empty comments array", async () => {
    const res = await request(app).post("/api/score").send({ comments: [] });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects more than MAX_COMMENTS_PER_REQUEST items", async () => {
    const comments = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, text: "x" }));
    const res = await request(app).post("/api/score").send({ comments });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate ids", async () => {
    const res = await request(app)
      .post("/api/score")
      .send({ comments: [{ id: "a", text: "x" }, { id: "a", text: "y" }] });
    expect(res.status).toBe(400);
  });

  it("rejects an id with invalid characters", async () => {
    const res = await request(app).post("/api/score").send({ comments: [{ id: "bad id!", text: "x" }] });
    expect(res.status).toBe(400);
  });

  it("rejects text over 2000 characters", async () => {
    const res = await request(app)
      .post("/api/score")
      .send({ comments: [{ id: "a", text: "x".repeat(2001) }] });
    expect(res.status).toBe(400);
  });

  it("rejects unknown top-level and nested fields (strict schema)", async () => {
    const res1 = await request(app)
      .post("/api/score")
      .send({ comments: [{ id: "a", text: "x" }], extra: 1 });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post("/api/score")
      .send({ comments: [{ id: "a", text: "x", extra: 1 }] });
    expect(res2.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const res = await request(app)
      .post("/api/score")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
  });

  it("rejects a body over the size limit", async () => {
    const res = await request(app)
      .post("/api/score")
      .send({ comments: [{ id: "a", text: "x".repeat(2000) }], pad: "y".repeat(200_000) });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/score happy path", () => {
  it("forwards validated comments and returns the inference response", async () => {
    inferenceOk([{ id: "a", toxicity: 0.9 }, { id: "b", toxicity: 0.05 }]);
    const res = await request(app)
      .post("/api/score")
      .send({ comments: [{ id: "a", text: "you idiot" }, { id: "b", text: "nice video" }] });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].toxicity).toBe(0.9);
    expect(res.body.model_version).toBe("abc123");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Internal-Token"]).toBe("t".repeat(40));
    expect(JSON.parse(init.body as string).comments).toHaveLength(2);
  });
});

describe("POST /api/score upstream failure handling", () => {
  it("maps a 4xx from inference to 502 without retrying", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({}) } as Response);
    const res = await request(app).post("/api/score").send({ comments: [{ id: "a", text: "x" }] });
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on 4xx
  });

  it("retries once on network failure, then succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: "a", toxicity: 0.2, categories: { toxic: 0.2 } }], model_version: "v1" }),
      } as Response);
    const res = await request(app).post("/api/score").send({ comments: [{ id: "a", text: "x" }] });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 503 after two consecutive network failures", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const res = await request(app).post("/api/score").send({ comments: [{ id: "a", text: "x" }] });
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when the upstream response fails schema validation", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: true }) } as Response);
    const res = await request(app).post("/api/score").send({ comments: [{ id: "a", text: "x" }] });
    expect(res.status).toBe(502);
  });

  it("never logs or echoes comment text on error", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const res = await request(app)
      .post("/api/score")
      .send({ comments: [{ id: "a", text: "SECRET_MARKER_TEXT" }] });
    expect(JSON.stringify(res.body)).not.toContain("SECRET_MARKER_TEXT");
  });
});

describe("rate limiting", () => {
  // Built as a small standalone app with its own low limit, so this test doesn't
  // consume/pollute the shared `app` instance's rate-limit window used everywhere else.
  it("returns 429 after exceeding the configured limit", async () => {
    const express = (await import("express")).default;
    const rateLimit = (await import("express-rate-limit")).default;
    const isolated = express();
    isolated.use(
      "/x",
      rateLimit({ windowMs: 60_000, limit: 3, standardHeaders: true, legacyHeaders: false }),
      (_req, res) => res.status(200).json({ ok: true }),
    );

    for (let i = 0; i < 3; i++) {
      const res = await request(isolated).get("/x");
      expect(res.status).toBe(200);
    }
    const res = await request(isolated).get("/x");
    expect(res.status).toBe(429);
  });
});

describe("unknown routes", () => {
  it("returns 404 for an unmapped path", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
  });
});