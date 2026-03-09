// Spawns electron pointing at dist-electron/main.js, forwards exit code
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const mainFile = join(desktopDir, "dist-electron", "main.js");

const require = createRequire(import.meta.url);
const electronPath = String(require("electron"));

const child = spawn(electronPath, [mainFile], {
  stdio: "inherit",
  env: { ...process.env },
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill();
});

process.on("SIGTERM", () => {
  child.kill();
});
