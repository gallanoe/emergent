import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Core executor
// ---------------------------------------------------------------------------

export function execOv(args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile("ov", args, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("'ov' command not found. Is Overstory installed and on PATH?"));
        return;
      }
      resolve({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        exitCode: error ? (error as { code?: number }).code ?? 1 : 0,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Coordinator operations
// ---------------------------------------------------------------------------

export async function coordinatorStatus(
  cwd: string,
): Promise<{ running: boolean; error?: string }> {
  try {
    const result = await execOv(["coordinator", "status", "--json"], cwd);
    try {
      const parsed = JSON.parse(result.stdout) as { running?: boolean };
      return { running: !!parsed.running };
    } catch {
      // Non-JSON output — infer from exit code
      return { running: result.exitCode === 0 };
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return { running: false, error: "ov_not_found" };
    }
    return { running: false, error: String(err) };
  }
}

export function coordinatorStart(cwd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "ov",
      ["coordinator", "start"],
      { cwd, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new Error(
              "'ov' command not found. Is Overstory installed and on PATH?",
            ),
          );
          return;
        }
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: error ? (error as { code?: number }).code ?? 1 : 0,
        });
      },
    );
  });
}

export function coordinatorStop(cwd: string): Promise<ExecResult> {
  return execOv(["coordinator", "stop"], cwd);
}

export function hasOverstoryConfig(workspacePath: string): boolean {
  return existsSync(join(workspacePath, ".overstory", "config.yaml"));
}

// ---------------------------------------------------------------------------
// Agent operations
// ---------------------------------------------------------------------------

export async function slingAgent(
  cwd: string,
  taskId: string,
  capability: string,
  runtime?: string,
): Promise<ExecResult> {
  const args = ["sling", "--task", taskId, "--capability", capability];
  if (runtime) {
    args.push("--runtime", runtime);
  }
  return execOv(args, cwd);
}

export async function stopAgent(
  cwd: string,
  agentName: string,
): Promise<ExecResult> {
  return execOv(["stop", agentName], cwd);
}

export async function nudgeAgent(
  cwd: string,
  agentName: string,
  message: string,
): Promise<ExecResult> {
  return execOv(["nudge", agentName, message], cwd);
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export async function sendMail(
  cwd: string,
  to: string,
  subject: string,
  body: string,
  type?: string,
  priority?: string,
): Promise<ExecResult> {
  const args = ["mail", "send", "--to", to, "--subject", subject, "--body", body];
  if (type) {
    args.push("--type", type);
  }
  if (priority) {
    args.push("--priority", priority);
  }
  return execOv(args, cwd);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export async function triggerMerge(
  cwd: string,
  branchName: string,
): Promise<ExecResult> {
  return execOv(["merge", branchName], cwd);
}
