// Smoke test: spawns Electron, checks for fatal errors, exits
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const mainFile = join(desktopDir, "dist-electron", "main.js");

const require = createRequire(import.meta.url);
const electronPath = String(require("electron"));

const TIMEOUT_MS = 8000;
const FATAL_PATTERNS = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Uncaught Error",
  "FATAL ERROR",
  "UnhandledPromiseRejection",
];

let output = "";
let exitCode = null;

const child = spawn(electronPath, [mainFile], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

child.stdout.on("data", (data) => {
  output += data.toString();
  process.stdout.write(data);
});

child.stderr.on("data", (data) => {
  output += data.toString();
  process.stderr.write(data);
});

child.on("close", (code) => {
  exitCode = code;
});

setTimeout(() => {
  // Check for fatal patterns in output
  const hasFatal = FATAL_PATTERNS.some((pattern) => output.includes(pattern));

  if (hasFatal) {
    console.error("\nSmoke test FAILED: fatal error pattern detected in output");
    child.kill();
    process.exit(1);
  }

  if (exitCode !== null && exitCode !== 0) {
    console.error(`\nSmoke test FAILED: electron exited with code ${exitCode}`);
    process.exit(1);
  }

  console.log("\nSmoke test PASSED");
  child.kill();
  process.exit(0);
}, TIMEOUT_MS);
