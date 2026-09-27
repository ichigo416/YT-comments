// Bundles the extension into ./dist and generates manifest.json.
// Usage:  API_BASE_URL=https://api.example.com npm run build   (defaults to http://localhost:8080)
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const apiUrl = new URL(process.env.API_BASE_URL ?? "http://localhost:8080");
if (apiUrl.protocol !== "https:" && !LOCAL_HOSTS.has(apiUrl.hostname)) {
  throw new Error("API_BASE_URL must use https:// unless it points at localhost");
}

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    popup: "src/popup/main.tsx",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome110",
  jsx: "automatic",
  minify: true,
  define: {
    __API_BASE__: JSON.stringify(apiUrl.origin),
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "info",
});

cpSync("static", "dist", { recursive: true });

const manifest = {
  manifest_version: 3,
  name: "Comment Toxicity Scorer for YouTube",
  version: "1.0.0",
  description: "Scores YouTube comments for toxicity and lets you badge or blur the toxic ones.",
  permissions: ["storage"],
  host_permissions: ["https://www.youtube.com/*", `${apiUrl.origin}/*`],
  background: { service_worker: "background.js" },
  content_scripts: [
    {
      matches: ["https://www.youtube.com/*"],
      js: ["content.js"],
      css: ["content.css"],
      run_at: "document_idle",
    },
  ],
  action: { default_title: "Comment scorer", default_popup: "popup.html" },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};

writeFileSync("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built extension -> dist/  (API: ${apiUrl.origin})`);
