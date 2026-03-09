import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

const BASE_SERVER_PORT = 3773;
const BASE_WEB_PORT = 5733;

type Mode = "dev" | "dev:server" | "dev:web" | "dev:desktop";

function getPortOffset(): number {
  const offsetEnv = process.env["EMERGENT_PORT_OFFSET"];
  if (offsetEnv) return Number(offsetEnv);

  const instanceEnv = process.env["EMERGENT_DEV_INSTANCE"];
  if (instanceEnv) {
    const hash = createHash("md5").update(instanceEnv).digest("hex");
    return (parseInt(hash.slice(0, 4), 16) % 100) * 10;
  }

  return 0;
}

function getModeArgs(mode: Mode): string[] {
  switch (mode) {
    case "dev":
      return [
        "run",
        "turbo",
        "run",
        "dev",
        "--filter=@emergent/contracts",
        "--filter=@emergent/web",
        "--filter=@emergent/server",
      ];
    case "dev:server":
      return [
        "run",
        "turbo",
        "run",
        "dev",
        "--filter=@emergent/contracts",
        "--filter=@emergent/server",
      ];
    case "dev:web":
      return [
        "run",
        "turbo",
        "run",
        "dev",
        "--filter=@emergent/contracts",
        "--filter=@emergent/web",
      ];
    case "dev:desktop":
      return [
        "run",
        "turbo",
        "run",
        "dev",
        "--filter=@emergent/contracts",
        "--filter=@emergent/web",
        "--filter=@emergent/server",
        "--filter=@emergent/desktop",
      ];
  }
}

const mode = process.argv[2] as Mode | undefined;

if (!mode || !["dev", "dev:server", "dev:web", "dev:desktop"].includes(mode)) {
  console.error(
    `Usage: dev-runner.ts <dev|dev:server|dev:web|dev:desktop>`,
  );
  process.exit(1);
}

const offset = getPortOffset();
const serverPort = BASE_SERVER_PORT + offset;
const webPort = BASE_WEB_PORT + offset;
const stateDir =
  process.env["EMERGENT_STATE_DIR"] ??
  path.join(os.homedir(), ".emergent", "dev");

const env = {
  ...process.env,
  EMERGENT_PORT: String(serverPort),
  PORT: String(webPort),
  ELECTRON_RENDERER_PORT: String(webPort),
  VITE_WS_URL: `ws://localhost:${serverPort}`,
  VITE_DEV_SERVER_URL: `http://localhost:${webPort}`,
  EMERGENT_STATE_DIR: stateDir,
};

const args = getModeArgs(mode);

const child = spawn("bun", args, {
  stdio: "inherit",
  env,
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});
