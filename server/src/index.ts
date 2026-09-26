import { createApp } from "./app.js";
import { config } from "./config.js";

const server = createApp().listen(config.PORT, () => {
  console.log(`Gateway listening on port ${config.PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
