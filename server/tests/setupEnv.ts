// Loaded before any test file. Provides a valid env so config.ts (which exits
// the process on invalid config) never sees a missing/short value during tests.
process.env.NODE_ENV = "test";
process.env.ALLOWED_ORIGINS = "https://allowed.example,chrome-extension://testextensionid";
process.env.INFERENCE_URL = "http://127.0.0.1:9999";
process.env.INTERNAL_API_TOKEN = "t".repeat(40);
process.env.RATE_LIMIT_WINDOW_MS = "60000";
// High on purpose: keeps the ~15 functional tests in score.test.ts from tripping
// the limiter. The limiter's own behaviour is tested in isolation, with its own
// small limit, in the "rate limiting" describe block below.
process.env.RATE_LIMIT_MAX = "1000";
process.env.MAX_COMMENTS_PER_REQUEST = "5";
process.env.INFERENCE_TIMEOUT_MS = "500";