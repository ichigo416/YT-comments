import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: false,
  },
  define: { __SERVER_URL__: JSON.stringify("http://127.0.0.1:3000") },
}); 