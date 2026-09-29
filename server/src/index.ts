/**
 * Process entry point: starts the HTTP server and wires up graceful shutdown.
 * Kept separate from app.ts so tests can import createApp() without opening a port.
 */
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

const server: Server = app.listen(config.PORT, () => {
  console.log(`commentlens-server listening on port ${config.PORT} (${config.NODE_ENV})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close((err) => {
    if (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
    process.exit(0);
  });
  // Force-exit if connections don't close in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});