import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setupEnv.ts"],
    hookTimeout: 20000,
  },
}); 