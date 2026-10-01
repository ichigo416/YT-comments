/**
 * Build script for all three extension entry points, using esbuild directly
 * (no Vite/@crxjs — MV3 content scripts and service workers cannot be ES
 * modules loaded by <script type=module> in the page, so everything is
 * bundled to a plain IIFE; the popup is the one bundle that can stay a module).
 *
 * Usage:
 *   node build.mjs                 -> production build (minified, HTTPS-only SERVER_URL required)
 *   node build.mjs --watch         -> dev build (unminified, allows http://127.0.0.1)
 *   node build.mjs --server-url=<url>   -> override the baked-in SERVER_URL
 */
import { build, context } from "esbuild";
import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import path from "node:path";

const isWatch = process.argv.includes("--watch");
const cliServerUrl = process.argv.find((a) => a.startsWith("--server-url="))?.split("=")[1];
const serverUrl = cliServerUrl ?? (isWatch ? "http://127.0.0.1:3000" : process.env.SERVER_URL);

if (!isWatch) {
  if (!serverUrl) {
    console.error("Production build requires SERVER_URL (env var or --server-url=<https://...>).");
    process.exit(1);
  }
  const url = new URL(serverUrl); // throws on malformed input
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLocal) {
    console.error("SERVER_URL must be https:// for a production build.");
    process.exit(1);
  }
}

const OUT_DIR = "dist";
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const define = { __SERVER_URL__: JSON.stringify(serverUrl) };
const shared = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch,
  target: "chrome116",
  define,
  logLevel: "info",
};

const entries = [
  { entryPoints: ["src/background/index.ts"], outfile: `${OUT_DIR}/background.js`, format: "iife" },
  { entryPoints: ["src/content/index.ts"], outfile: `${OUT_DIR}/content.js`, format: "iife" },
  { entryPoints: ["src/popup/main.tsx"], outfile: `${OUT_DIR}/popup.js`, format: "iife" },
];

function copyStaticFiles() {
  cpSync("public", OUT_DIR, { recursive: true });
  console.log("Copied public/ -> dist/");
}

if (isWatch) {
  const ctxs = await Promise.all(entries.map((e) => context({ ...shared, ...e })));
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStaticFiles();
  console.log("Watching for changes (Ctrl+C to stop)...");
} else {
  for (const entry of entries) {
    await build({ ...shared, ...entry });
  }
  copyStaticFiles();
  console.log(`Production build complete -> ${path.resolve(OUT_DIR)} (SERVER_URL=${serverUrl})`);
}