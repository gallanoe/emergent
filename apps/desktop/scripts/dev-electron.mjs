// Waits for Vite dev server + built electron files, then spawns electron
import { existsSync, watch } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const distElectron = join(desktopDir, "dist-electron");

const VITE_DEV_SERVER_URL =
  process.env["VITE_DEV_SERVER_URL"] ?? "http://localhost:5733";
const ELECTRON_RENDERER_PORT =
  process.env["ELECTRON_RENDERER_PORT"] ?? "5733";

const require = createRequire(import.meta.url);

async function waitForFile(filePath, timeoutMs = 30_000) {
  const start = Date.now();
  while (!existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let electronProcess = null;

function spawnElectron() {
  if (electronProcess) {
    electronProcess.kill();
    electronProcess = null;
  }

  const electronPath = require("electron");
  const mainFile = join(distElectron, "main.js");

  electronProcess = spawn(String(electronPath), [mainFile], {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL,
      ELECTRON_RENDERER_PORT,
    },
  });

  electronProcess.on("close", (code) => {
    if (code !== null) process.exit(code);
  });
}

async function main() {
  const mainFile = join(distElectron, "main.js");

  console.log("Waiting for electron build...");
  await waitForFile(mainFile);

  console.log("Waiting for Vite dev server...");
  await waitForServer(VITE_DEV_SERVER_URL);

  console.log("Starting Electron...");
  spawnElectron();

  // Watch for rebuild and restart
  watch(distElectron, { recursive: true }, (event, filename) => {
    if (filename && filename.endsWith(".js")) {
      console.log(`Detected change in ${filename}, restarting Electron...`);
      spawnElectron();
    }
  });
}

process.on("SIGINT", () => {
  if (electronProcess) electronProcess.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (electronProcess) electronProcess.kill();
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
