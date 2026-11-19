import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(__dirname, "..");

console.log("[start:dev] Starting TypeScript compiler in watch mode with full decorator metadata...");
const tsc = spawn("npx", ["tsc", "-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"], {
  cwd: apiDir,
  stdio: "inherit",
  shell: true,
});

const distMain = path.join(apiDir, "dist", "main.js");

function startApp() {
  console.log("[start:dev] Starting Node API server with --watch on dist/main.js...");
  const app = spawn("node", ["--watch", "dist/main.js"], {
    cwd: apiDir,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  const cleanup = () => {
    try { tsc.kill(); } catch {}
    try { app.kill(); } catch {}
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

if (fs.existsSync(distMain)) {
  startApp();
} else {
  const interval = setInterval(() => {
    if (fs.existsSync(distMain)) {
      clearInterval(interval);
      startApp();
    }
  }, 500);
}
